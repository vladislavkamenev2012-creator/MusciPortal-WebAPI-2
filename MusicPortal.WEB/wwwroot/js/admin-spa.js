/*
 * Одностраничное (SPA) приложение администратора «Музичний портал».
 * Работает с REST-сервисом через Fetch API:
 *   GET    /api/{entity}        - список
 *   POST   /api/{entity}        - добавление
 *   PUT    /api/{entity}/{id}   - изменение
 *   DELETE /api/{entity}/{id}   - удаление
 * Страница не перезагружается: разделы переключаются через #hash, данные обновляются через fetch.
 */
(function () {
    'use strict';

    const t = (key) => (window.ADMIN_I18N && window.ADMIN_I18N[key]) || key;

    // ---------- Вспомогательные функции ----------

    /** Создание DOM-элемента (текст вставляется через textContent - защита от XSS). */
    function h(tag, attrs, ...children) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (k === 'class') el.className = v;
            else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
            else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
        }
        for (const c of children.flat()) {
            if (c == null || c === false) continue;
            el.append(c.nodeType ? c : document.createTextNode(String(c)));
        }
        return el;
    }

    class ApiError extends Error {
        constructor(status, message) { super(message); this.status = status; }
    }

    /** Разбор ответа сервера с ошибкой в понятное сообщение. */
    async function readError(res) {
        if (res.status === 401 || res.status === 403) return new ApiError(res.status, t('ErrSession'));
        if (res.status === 404) return new ApiError(res.status, t('ErrNotFound'));
        let msg = t('ErrGeneric') + ' (' + res.status + ')';
        try {
            const data = await res.json();
            if (data.errors) msg = Object.values(data.errors).flat().join(' ');   // 400: ошибки валидации
            else if (data.message) msg = data.message;                             // 409: логин занят
            else if (data.title) msg = data.title;
        } catch { /* тело ответа пустое или не JSON */ }
        return new ApiError(res.status, msg);
    }

    /** Единая обёртка над fetch для всех HTTP-методов. */
    async function api(method, url, body) {
        const options = {
            method,
            headers: { 'Accept': 'application/json' },
            credentials: 'same-origin'
        };
        if (body !== undefined) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }
        let res;
        try {
            res = await fetch(url, options);
        } catch {
            throw new ApiError(0, t('ErrGeneric'));
        }
        if (!res.ok) throw await readError(res);
        return res.status === 204 ? null : res.json();
    }

    // ---------- Уведомления ----------

    const alertsBox = document.getElementById('spa-alerts');

    function notify(message, type) {
        const el = h('div', { class: 'alert alert-' + type + ' alert-dismissible fade show', role: 'alert' },
            message,
            h('button', { type: 'button', class: 'btn-close', 'data-bs-dismiss': 'alert' }));
        alertsBox.replaceChildren(el);
        if (type === 'success') setTimeout(() => el.remove(), 3000);
    }

    // ---------- Описание разделов (сущностей) ----------

    const roleOptions = ['Admin', 'User', 'Pending'];

    const entities = {
        users: {
            url: '/api/users',
            tab: 'TabUsers', newTitle: 'NewUser', editTitle: 'EditUser', confirmDelete: 'ConfirmDeleteUser',
            columns: [
                { title: 'Username', render: (u) => u.username },
                { title: 'Role', render: (u) => u.role },
                {
                    title: 'Status',
                    render: (u) => u.isApproved
                        ? h('span', { class: 'badge bg-success' }, t('Active'))
                        : h('span', { class: 'badge bg-warning text-dark' }, t('PendingApproval'))
                }
            ],
            fields: [
                { name: 'username', label: 'Username', type: 'text', required: true },
                { name: 'password', label: 'Password', type: 'password', requiredOnCreate: true, hintOnEdit: 'PasswordKeepHint' },
                { name: 'role', label: 'Role', type: 'select', options: roleOptions },
                { name: 'isApproved', label: 'ApprovedCheck', type: 'checkbox' }
            ],
            defaults: { username: '', password: '', role: 'User', isApproved: true },
            // Дополнительная кнопка: подтверждение заявки на регистрацию
            extraActions: (item, reload) => item.isApproved ? [] : [
                h('button', {
                    class: 'btn btn-success btn-sm me-1',
                    onclick: async () => {
                        try {
                            await api('PUT', '/api/users/' + item.id,
                                { username: item.username, role: 'User', isApproved: true });
                            notify(t('MsgSaved'), 'success');
                            reload();
                        } catch (e) { notify(e.message, 'danger'); }
                    }
                }, t('Approve'))
            ]
        },
        artists: {
            url: '/api/artists',
            tab: 'TabArtists', newTitle: 'NewArtist', editTitle: 'EditArtist', confirmDelete: 'ConfirmDeleteArtist',
            columns: [{ title: 'Name', render: (a) => a.name }],
            fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
            defaults: { name: '' }
        },
        genres: {
            url: '/api/genres',
            tab: 'TabGenres', newTitle: 'NewGenreTitle', editTitle: 'EditGenre', confirmDelete: 'ConfirmDeleteGenre',
            columns: [{ title: 'Name', render: (g) => g.name }],
            fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
            defaults: { name: '' }
        }
    };

    // ---------- Рендер раздела ----------

    const view = document.getElementById('spa-view');
    let current = null;       // ключ текущего раздела
    let renderToken = 0;      // защита от гонок при быстром переключении вкладок

    async function showSection(key) {
        const cfg = entities[key];
        current = key;
        const token = ++renderToken;

        document.querySelectorAll('#spa-tabs .nav-link')
            .forEach((a) => a.classList.toggle('active', a.dataset.route === key));

        view.replaceChildren(h('div', { class: 'text-muted' }, t('Loading')));

        let items;
        try {
            items = await api('GET', cfg.url);
        } catch (e) {
            if (token === renderToken) { view.replaceChildren(); notify(e.message, 'danger'); }
            return;
        }
        if (token !== renderToken) return;   // пользователь уже ушёл на другую вкладку

        const reload = () => showSection(key);

        const thead = h('thead', { class: 'table-dark' },
            h('tr', {},
                cfg.columns.map((c) => h('th', {}, t(c.title))),
                h('th', { style: 'width:1%; white-space:nowrap' }, t('Actions'))));

        const rows = items.map((item) => h('tr', {},
            cfg.columns.map((c) => h('td', {}, c.render(item))),
            h('td', { class: 'text-nowrap' },
                cfg.extraActions ? cfg.extraActions(item, reload) : [],
                h('button', { class: 'btn btn-outline-primary btn-sm me-1', onclick: () => openForm(key, item) }, t('Edit')),
                h('button', { class: 'btn btn-danger btn-sm', onclick: () => removeItem(key, item) }, t('Delete')))));

        if (rows.length === 0) {
            rows.push(h('tr', {}, h('td', { colspan: cfg.columns.length + 1, class: 'text-center text-muted' }, t('NoData'))));
        }

        view.replaceChildren(
            h('div', { class: 'd-flex justify-content-between align-items-center mb-3' },
                h('h4', { class: 'mb-0' }, t(cfg.tab)),
                h('button', { class: 'btn btn-primary', onclick: () => openForm(key, null) }, '+ ' + t('Add'))),
            h('table', { class: 'table table-bordered align-middle' }, thead, h('tbody', {}, rows)));
    }

    // ---------- Удаление (DELETE) ----------

    async function removeItem(key, item) {
        const cfg = entities[key];
        if (!confirm(t(cfg.confirmDelete))) return;
        try {
            await api('DELETE', cfg.url + '/' + item.id);
            notify(t('MsgDeleted'), 'success');
        } catch (e) {
            notify(e.message, 'danger');
        }
        showSection(key);
    }

    // ---------- Форма добавления / редактирования (POST / PUT) ----------

    const modalEl = document.getElementById('entity-modal');
    const modal = new bootstrap.Modal(modalEl);
    const form = document.getElementById('entity-form');
    const formBody = document.getElementById('entity-modal-body');
    const formError = document.getElementById('entity-modal-error');
    const saveBtn = document.getElementById('entity-modal-save');
    let editing = null;   // { key, item|null }

    function buildField(f, value, isEdit) {
        const id = 'f-' + f.name;
        const required = f.required || (f.requiredOnCreate && !isEdit);
        let input;

        if (f.type === 'select') {
            input = h('select', { class: 'form-select', id, name: f.name },
                f.options.map((o) => h('option', { value: o, selected: o === value }, o)));
        } else if (f.type === 'checkbox') {
            input = h('input', { class: 'form-check-input', type: 'checkbox', id, name: f.name, checked: !!value });
            return h('div', { class: 'form-check mb-3' }, input, h('label', { class: 'form-check-label', for: id }, t(f.label)));
        } else {
            input = h('input', {
                class: 'form-control', type: f.type, id, name: f.name, required,
                autocomplete: f.type === 'password' ? 'new-password' : 'off'
            });
            input.value = value ?? '';
        }
        return h('div', { class: 'mb-3' },
            h('label', { class: 'form-label', for: id }, t(f.label)),
            input,
            isEdit && f.hintOnEdit ? h('div', { class: 'form-text' }, t(f.hintOnEdit)) : null);
    }

    function openForm(key, item) {
        const cfg = entities[key];
        const isEdit = !!item;
        editing = { key, item };
        formError.textContent = '';
        document.getElementById('entity-modal-title').textContent = t(isEdit ? cfg.editTitle : cfg.newTitle);

        const values = isEdit ? { ...cfg.defaults, ...item, password: '' } : cfg.defaults;
        formBody.replaceChildren(...cfg.fields.map((f) => buildField(f, values[f.name], isEdit)));
        modal.show();
        const first = formBody.querySelector('input,select');
        modalEl.addEventListener('shown.bs.modal', () => first && first.focus(), { once: true });
    }

    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!editing) return;
        const { key, item } = editing;
        const cfg = entities[key];

        // сбор данных формы в JSON-объект
        const body = {};
        for (const f of cfg.fields) {
            const el = form.elements[f.name];
            body[f.name] = f.type === 'checkbox' ? el.checked : el.value;
        }
        if (key === 'users' && item && !body.password) delete body.password;  // пароль не меняем

        formError.textContent = '';
        saveBtn.disabled = true;
        try {
            if (item) await api('PUT', cfg.url + '/' + item.id, body);    // изменение
            else await api('POST', cfg.url, body);                         // добавление
            modal.hide();
            notify(t('MsgSaved'), 'success');
            showSection(key);
        } catch (e) {
            formError.textContent = e.message;   // ошибка валидации / конфликт показываются в окне
        } finally {
            saveBtn.disabled = false;
        }
    });

    // ---------- Маршрутизация по #hash ----------

    function route() {
        const key = location.hash.replace('#', '');
        showSection(entities[key] ? key : 'users');
    }

    window.addEventListener('hashchange', route);
    route();
})();
