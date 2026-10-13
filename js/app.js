$(function () {
  'use strict';

  const API = 'php/api.php';
  const S = { departments: [], locations: [], titles: [], total: 0, people: [] };
  let listSeq = 0;      // guards against out-of-order responses
  let currentId = null; // employee shown in profile / targeted by delete
  let pendingDelete = null;
  let orgType = null;

  const profileModal = new bootstrap.Modal(document.getElementById('profileModal'));
  const formModal = new bootstrap.Modal(document.getElementById('formModal'));
  const orgFormModal = new bootstrap.Modal(document.getElementById('orgFormModal'));
  const deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'));

  /* ------------------------------------------------------------ helpers */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fullName(p) { return p.firstName + ' ' + p.lastName; }
  function initials(p) { return (p.firstName.charAt(0) + p.lastName.charAt(0)).toUpperCase(); }
  function colour(depId) { return 'hsl(' + ((depId * 47) % 360) + ' 48% 32%)'; }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function call(action, data, method) {
    method = method || 'GET';
    const opts = { method: method, dataType: 'json', url: API };
    if (method === 'GET') {
      opts.data = $.extend({ action: action }, data || {});
    } else {
      opts.url = API + '?action=' + action;
      opts.data = data || {};
    }
    return $.ajax(opts);
  }
  function errorOf(xhr) {
    if (xhr && xhr.responseJSON && xhr.responseJSON.message) return xhr.responseJSON.message;
    return 'The server could not be reached. Check your connection and try again.';
  }

  function toast(message, type) {
    const $t = $(
      '<div class="toast align-items-center text-bg-' + (type === 'error' ? 'danger' : 'success') +
      ' border-0" role="alert" aria-live="assertive" aria-atomic="true">' +
      '<div class="d-flex"><div class="toast-body">' + esc(message) + '</div>' +
      '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div></div>'
    );
    $('#toasts').append($t);
    const t = new bootstrap.Toast($t[0], { delay: 5000 });
    $t.on('hidden.bs.toast', function () { $t.remove(); });
    t.show();
  }

  function swapModal(from, to) {
    from._element.addEventListener('hidden.bs.modal', function once() {
      from._element.removeEventListener('hidden.bs.modal', once);
      to.show();
    });
    from.hide();
  }

  /* ------------------------------------------------------------ views */
  function showView(name) {
    $('.view').addClass('d-none');
    $('#view-' + name).removeClass('d-none');
    $('.tab').removeClass('active').filter('[data-view="' + name + '"]').addClass('active');
    window.scrollTo(0, 0);
  }
  $('.tab').on('click', function () {
    showView($(this).data('view'));
    refreshData();
  });
  $('#brand').on('click', function (e) { e.preventDefault(); clearFilters(); showView('directory'); });

  /* ------------------------------------------------------------ filters + departments/locations */
  function fillSelect($sel, items, valueFn, labelFn, placeholder) {
    const keep = $sel.val();
    $sel.empty().append($('<option>').val('').text(placeholder));
    items.forEach(function (it) {
      $sel.append($('<option>').val(valueFn(it)).text(labelFn(it)));
    });
    if (keep) $sel.val(keep);
  }

  function loadFilters() {
    return call('filters').done(function (res) {
      $.extend(S, res.data);
      fillSelect($('#fDepartment'), S.departments, function (d) { return d.id; }, function (d) { return d.name; }, 'All departments');
      fillSelect($('#fLocation'), S.locations, function (l) { return l.id; }, function (l) { return l.name; }, 'All locations');
      fillSelect($('#fTitle'), S.titles, function (t) { return t.name; }, function (t) { return t.name; }, 'All job titles');

      $('#departmentGrid').html(S.departments.map(function (d) {
        return '<div class="col-sm-6 col-lg-4"><article class="tile">' +
          '<button type="button" class="tile-open" data-dep="' + d.id + '">' +
          '<span class="t-name d-block">' + esc(d.name) + '</span>' +
          '<span class="t-count d-block">' + esc(d.location) + ' office, ' + plural(d.employeeCount, 'employee') + '</span></button>' +
          '<div class="tile-actions"><button type="button" class="btn btn-sm btn-outline-secondary" data-org-edit="department" data-id="' + d.id + '">Edit</button>' +
          '<button type="button" class="btn btn-sm btn-outline-danger" data-org-delete="department" data-id="' + d.id + '" data-name="' + esc(d.name) + '">Delete</button></div></article></div>';
      }).join(''));
      $('#locationGrid').html(S.locations.map(function (l) {
        return '<div class="col-sm-6 col-lg-4"><article class="tile">' +
          '<button type="button" class="tile-open" data-loc="' + l.id + '">' +
          '<span class="t-name d-block">' + esc(l.name) + '</span>' +
          '<span class="t-count d-block">' + plural(l.employeeCount, 'employee') + '</span></button>' +
          '<div class="tile-actions"><button type="button" class="btn btn-sm btn-outline-secondary" data-org-edit="location" data-id="' + l.id + '">Edit</button>' +
          '<button type="button" class="btn btn-sm btn-outline-danger" data-org-delete="location" data-id="' + l.id + '" data-name="' + esc(l.name) + '">Delete</button></div></article></div>';
      }).join(''));
    }).fail(function (xhr) { toast(errorOf(xhr), 'error'); });
  }

  $('#departmentGrid').on('click', '.tile-open', function () {
    clearFilters(true);
    $('#fDepartment').val($(this).data('dep'));
    showView('directory');
    loadList();
  });
  $('#locationGrid').on('click', '.tile-open', function () {
    clearFilters(true);
    $('#fLocation').val($(this).data('loc'));
    showView('directory');
    loadList();
  });

  /* ------------------------------------------------------------ list */
  function currentFilters() {
    return {
      search: $.trim($('#search').val()),
      departmentID: $('#fDepartment').val(),
      jobTitle: $('#fTitle').val(),
      locationID: $('#fLocation').val()
    };
  }
  function hasFilters() {
    const f = currentFilters();
    return !!(f.search || f.departmentID || f.jobTitle || f.locationID);
  }
  function clearFilters(silent) {
    $('#search').val('');
    $('#fDepartment, #fTitle, #fLocation').val('');
    if (!silent) loadList();
  }

  function loadList() {
    const seq = ++listSeq;
    $('#list').attr('aria-busy', 'true');
    return call('list', currentFilters()).done(function (res) {
      if (seq !== listSeq) return;
      renderList(res.data);
    }).fail(function (xhr) {
      if (seq !== listSeq) return;
      $('#list').html('<div class="empty"><h2>The directory could not be loaded</h2><p class="text-muted mb-3">' +
        esc(errorOf(xhr)) + '</p><button type="button" class="btn btn-brand" id="retryBtn">Try again</button></div>').attr('aria-busy', 'false');
      $('#resultInfo').text('Unable to load employees.');
    });
  }

  function refreshData() {
    return loadFilters().always(loadList);
  }

  function renderList(rows) {
    const filtered = hasFilters();
    if (!rows.length) {
      $('#resultInfo').text('0 employees match your search.');
      $('#list').html(
        '<div class="empty"><h2>No employees found</h2>' +
        '<p class="text-muted mb-3">Nobody matches your search and filters. Check the spelling or remove a filter.</p>' +
        '<button type="button" class="btn btn-brand" id="emptyClear">Clear search and filters</button></div>'
      ).attr('aria-busy', 'false');
      return;
    }
    $('#resultInfo').text(filtered
      ? 'Showing ' + rows.length + ' of ' + plural(S.total, 'employee')
      : plural(rows.length, 'employee') + ' across ' + plural(S.locations.length, 'office') + '.');

    $('#list').html(rows.map(function (r) {
      return '<button type="button" class="emp" data-id="' + r.id + '" aria-label="View profile of ' + esc(fullName(r)) + '">' +
        '<span class="avatar" style="background:' + colour(r.departmentID) + '" aria-hidden="true">' + esc(initials(r)) + '</span>' +
        '<span><span class="emp-name d-block">' + esc(fullName(r)) + '</span><span class="emp-title d-block">' + esc(r.jobTitle) + '</span></span>' +
        '<span class="emp-where"><span class="dept d-block">' + esc(r.department) + '</span><span class="d-block text-muted">' + esc(r.location) + '</span></span>' +
        '<span class="emp-contact"><span class="d-block">' + esc(r.email) + '</span><span class="d-block">' + esc(r.phone) + '</span></span>' +
        '</button>';
    }).join('')).attr('aria-busy', 'false');
  }

  let debounce = null;
  $('#search').on('input', function () {
    clearTimeout(debounce);
    debounce = setTimeout(loadList, 250);
  });
  $('#fDepartment, #fTitle, #fLocation').on('change', loadList);
  $('#clearBtn').on('click', function () { clearFilters(); });
  $('#list').on('click', '#emptyClear', function () { clearFilters(); });
  $('#list').on('click', '#retryBtn', function () { loadList(); });
  $('#list').on('click', '.emp', function () { openProfile($(this).data('id')); });

  /* ------------------------------------------------------------ profile */
  function openProfile(id, reuse) {
    call('get', { id: id }).done(function (res) {
      const p = res.data;
      currentId = p.id;
      const mgr = p.manager
        ? '<button type="button" class="link-btn" data-mgr="' + p.manager.id + '">' + esc(fullName(p.manager)) + '</button>, ' + esc(p.manager.jobTitle)
        : '<span class="text-muted">No manager recorded</span>';
      const reports = p.reports.length
        ? '<ul class="list-unstyled mb-0">' + p.reports.map(function (r) {
            return '<li><button type="button" class="link-btn" data-mgr="' + r.id + '">' + esc(fullName(r)) + '</button>, ' + esc(r.jobTitle) + '</li>';
          }).join('') + '</ul>'
        : '<span class="text-muted">None</span>';

      $('#profileBody').html(
        '<div class="profile-head"><span class="avatar" style="background:' + colour(p.departmentID) + '" aria-hidden="true">' + esc(initials(p)) + '</span>' +
        '<div><h3>' + esc(fullName(p)) + '</h3><div class="text-muted">' + esc(p.jobTitle) + '</div></div></div>' +
        '<dl class="profile-dl mb-0">' +
        '<dt>Department</dt><dd>' + esc(p.department) + '</dd>' +
        '<dt>Office location</dt><dd>' + esc(p.location) + '</dd>' +
        '<dt>Email</dt><dd><a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a></dd>' +
        '<dt>Phone</dt><dd><a href="tel:' + esc(p.phone.replace(/[^0-9+]/g, '')) + '">' + esc(p.phone) + '</a></dd>' +
        '<dt>Manager</dt><dd>' + mgr + '</dd>' +
        '<dt>Direct reports</dt><dd>' + reports + '</dd></dl>'
      );
      $('#profileTitle').text(fullName(p));
      if (!reuse) profileModal.show();
    }).fail(function (xhr) {
      toast(errorOf(xhr), 'error');
      loadFilters();
      loadList();
    });
  }
  $('#profileBody').on('click', '[data-mgr]', function () { openProfile($(this).data('mgr'), true); });
  $('#profileEdit').on('click', function () {
    $('#formModal').data('employeeId', currentId);
    swapModal(profileModal, formModal);
  });
  $('#profileDelete').on('click', function () {
    askDelete('delete', currentId, $('#profileTitle').text(), profileModal);
  });

  /* ------------------------------------------------------------ add / edit form */
  const $form = $('#employeeForm');
  const FIELDS = ['firstName', 'lastName', 'jobTitle', 'email', 'phone', 'departmentID', 'managerID'];

  function clearErrors() {
    $('#formAlert').addClass('d-none').text('');
    $form.find('.is-invalid').removeClass('is-invalid');
  }
  function fieldError(name, msg) {
    $('#' + name).addClass('is-invalid').siblings('.invalid-feedback').text(msg);
  }
  function syncLocation() {
    const d = S.departments.filter(function (x) { return String(x.id) === $('#departmentID').val(); })[0];
    $('#locationShow').val(d ? d.location : '');
  }
  $('#departmentID').on('change', syncLocation);
  $form.on('input change', 'input, select', function () { $(this).removeClass('is-invalid'); });

  function prepareForm(id) {
    $form[0].reset();
    clearErrors();
    $('#empId').val(id || '');
    $('#formTitle').text(id ? 'Edit employee' : 'Add employee');
    $('#saveBtn').text(id ? 'Save changes' : 'Save employee').prop('disabled', false);

    fillSelect($('#departmentID'), S.departments, function (d) { return d.id; },
      function (d) { return d.name + ' (' + d.location + ')'; }, 'Choose a department');
    $('#titleOptions').html(S.titles.map(function (t) { return '<option value="' + esc(t.name) + '">'; }).join(''));

    call('people').done(function (res) {
      S.people = res.data;
      fillSelect($('#managerID'), S.people.filter(function (p) { return String(p.id) !== String(id); }),
        function (p) { return p.id; },
        function (p) { return p.lastName + ', ' + p.firstName + ' (' + p.jobTitle + ')'; }, 'No manager');
      if (id) {
        call('get', { id: id }).done(function (r) {
          const p = r.data;
          FIELDS.forEach(function (f) { $('#' + f).val(p[f] == null ? '' : p[f]); });
          syncLocation();
        });
      } else {
        syncLocation();
      }
    }).fail(function (xhr) { toast(errorOf(xhr), 'error'); });
  }

  $('#formModal').on('show.bs.modal', function () {
    prepareForm($(this).data('employeeId') || null);
  });

  $('#addBtn').on('click', function () {
    $('#formModal').removeData('employeeId');
    formModal.show();
  });

  $form.on('submit', function (e) {
    e.preventDefault();
    clearErrors();
    let ok = true;
    $form.find('input[required], select[required]').each(function () {
      if (!this.checkValidity()) {
        ok = false;
        $(this).addClass('is-invalid').siblings('.invalid-feedback').text(this.validationMessage || 'This field is required.');
      }
    });
    if (!ok) {
      $('#formAlert').removeClass('d-none').text('Please fix the highlighted fields.');
      $form.find('.is-invalid').first().trigger('focus');
      return;
    }

    const id = $('#empId').val();
    const payload = {};
    FIELDS.forEach(function (f) { payload[f] = $.trim($('#' + f).val()); });
    if (id) payload.id = id;

    $('#saveBtn').prop('disabled', true).text('Saving…');
    call(id ? 'update' : 'create', payload, 'POST').done(function (res) {
      formModal.hide();
      toast(res.message, 'success');
      loadFilters();
      loadList();
    }).fail(function (xhr) {
      $('#saveBtn').prop('disabled', false).text(id ? 'Save changes' : 'Save employee');
      const body = xhr.responseJSON;
      $('#formAlert').removeClass('d-none').text(errorOf(xhr));
      if (body && body.errors) {
        Object.keys(body.errors).forEach(function (k) { fieldError(k, body.errors[k]); });
        $form.find('.is-invalid').first().trigger('focus');
      }
    });
  });

  /* ------------------------------------------------------------ department / location maintenance */
  const $orgForm = $('#orgForm');

  function prepareOrgForm(type, id) {
    orgType = type;
    const isDepartment = type === 'department';
    const entity = isDepartment ? 'department' : 'location';
    const records = isDepartment ? S.departments : S.locations;
    const record = id ? records.filter(function (item) { return String(item.id) === String(id); })[0] : null;

    $orgForm[0].reset();
    $orgForm.find('.is-invalid').removeClass('is-invalid');
    $('#orgFormAlert').addClass('d-none').text('');
    $('#orgId').val(id || '');
    $('#orgFormTitle').text((id ? 'Edit ' : 'Add ') + entity);
    $('#orgNameLabel').text(isDepartment ? 'Department name' : 'Location name');
    $('#orgName').attr('maxlength', isDepartment ? 80 : 60);
    $('#orgLocationField').toggleClass('d-none', !isDepartment);
    $('#orgLocationID').prop('required', isDepartment);
    $('#orgSaveBtn').text(id ? 'Save changes' : 'Save ' + entity).prop('disabled', false);
    fillSelect($('#orgLocationID'), S.locations, function (location) { return location.id; },
      function (location) { return location.name; }, 'Choose a location');
    if (record) {
      $('#orgName').val(record.name);
      if (isDepartment) $('#orgLocationID').val(record.locationID);
    }
  }

  function openOrgForm(type, id) {
    const records = type === 'department' ? S.departments : S.locations;
    if (id && !records.some(function (item) { return String(item.id) === String(id); })) {
      toast('This record is no longer available. The directory has been refreshed.', 'error');
      refreshData();
      return;
    }
    $('#orgFormModal').data('orgType', type).data('orgId', id || '');
    orgFormModal.show();
  }

  $('#orgFormModal').on('show.bs.modal', function () {
    prepareOrgForm($(this).data('orgType'), $(this).data('orgId') || null);
  });

  $('[data-org-create]').on('click', function () { openOrgForm($(this).data('org-create'), null); });
  $('#departmentGrid, #locationGrid').on('click', '[data-org-edit]', function () {
    openOrgForm($(this).data('org-edit'), $(this).data('id'));
  });
  $('#departmentGrid, #locationGrid').on('click', '[data-org-delete]', function () {
    const type = $(this).data('org-delete');
    const action = type === 'department' ? 'departmentDelete' : 'locationDelete';
    askDelete(action, $(this).data('id'), $(this).data('name'));
  });

  $orgForm.on('input change', 'input, select', function () {
    $(this).removeClass('is-invalid');
  });
  $orgForm.on('submit', function (e) {
    e.preventDefault();
    $('#orgFormAlert').addClass('d-none').text('');
    $orgForm.find('.is-invalid').removeClass('is-invalid');
    let valid = true;
    $orgForm.find('input[required], select[required]').each(function () {
      if (!this.checkValidity()) {
        valid = false;
        $(this).addClass('is-invalid').siblings('.invalid-feedback').text(this.validationMessage || 'This field is required.');
      }
    });
    if (!valid) {
      $('#orgFormAlert').removeClass('d-none').text('Please fix the highlighted fields.');
      $orgForm.find('.is-invalid').first().trigger('focus');
      return;
    }

    const id = $('#orgId').val();
    const action = orgType + (id ? 'Update' : 'Create');
    const payload = { name: $.trim($('#orgName').val()) };
    if (orgType === 'department') payload.locationID = $('#orgLocationID').val();
    if (id) payload.id = id;
    $('#orgSaveBtn').prop('disabled', true).text('Saving…');
    call(action, payload, 'POST').done(function (res) {
      orgFormModal.hide();
      toast(res.message, 'success');
      refreshData();
    }).fail(function (xhr) {
      $('#orgSaveBtn').prop('disabled', false).text(id ? 'Save changes' : 'Save ' + orgType);
      const body = xhr.responseJSON;
      $('#orgFormAlert').removeClass('d-none').text(errorOf(xhr));
      if (body && body.errors) {
        Object.keys(body.errors).forEach(function (key) {
          const field = key === 'locationID' ? 'orgLocationID' : 'orgName';
          $('#' + field).addClass('is-invalid').siblings('.invalid-feedback').text(body.errors[key]);
        });
        $orgForm.find('.is-invalid').first().trigger('focus');
      }
    });
  });

  /* ------------------------------------------------------------ delete with confirmation */
  function askDelete(action, id, name, sourceModal) {
    pendingDelete = { action: action, id: id };
    const isEmployee = action === 'delete';
    $('#deleteTitle').text(isEmployee ? 'Delete this employee?' : 'Delete this ' + (action.indexOf('department') === 0 ? 'department?' : 'location?'));
    $('#deleteText').text('You are about to delete ' + name + '. ' +
      (isEmployee
        ? 'This removes their record from the directory and cannot be undone.'
        : 'The record can only be deleted when no other records depend on it.'));
    $('#confirmDelete').text(isEmployee ? 'Delete employee' : 'Delete ' + (action.indexOf('department') === 0 ? 'department' : 'location'));
    if (sourceModal) swapModal(sourceModal, deleteModal);
    else deleteModal.show();
  }
  $('#confirmDelete').on('click', function () {
    const $btn = $(this).prop('disabled', true);
    if (!pendingDelete) return;
    call(pendingDelete.action, { id: pendingDelete.id }, 'POST').done(function (res) {
      deleteModal.hide();
      toast(res.message, 'success');
    }).fail(function (xhr) {
      deleteModal.hide();
      toast(errorOf(xhr), 'error');
    }).always(function () {
      $btn.prop('disabled', false);
      pendingDelete = null;
      refreshData();
    });
  });

  /* ------------------------------------------------------------ start */
  refreshData();
  $(window).on('focus', function () {
    if (document.visibilityState === 'visible') refreshData();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refreshData();
  });
  window.setInterval(function () {
    if (document.visibilityState === 'visible') refreshData();
  }, 60000);
});
