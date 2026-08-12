  'use strict';

  // ===========================================================================
  // Gallery tab — browse / re-download / delete all generated images + videos
  // ===========================================================================

  function openGalleryTab() {
    setMediaTab('gallery');
    refreshGallery();
  }

  async function refreshGallery() {
    if (!dom.galleryGrid) return;
    const kind = dom.galleryFilter.value;
    dom.galleryStatus.textContent = 'Loading…';
    try {
      const q = kind ? `?kind=${encodeURIComponent(kind)}&limit=120` : '?limit=120';
      const response = await apiFetch('/api/gallery' + q);
      const payload = await response.json();
      if (!response.ok) throw new Error(detail(payload, response));
      renderGallery(payload.items || []);
      const status = payload.status || null;
      const summary = status
        ? `${status.images_count} image(s) + ${status.videos_count} video(s), ${(status.bytes_total/1024/1024).toFixed(1)} MB`
        : `${payload.items.length} item(s)`;
      dom.galleryStatus.textContent = summary;
    } catch (error) {
      dom.galleryStatus.textContent = 'Error: ' + error.message;
    }
  }

  function renderGallery(items) {
    dom.galleryGrid.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No media generated yet. Use the Image or Video tabs.';
      dom.galleryGrid.append(empty);
      return;
    }
    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'image-card';
      const meta = document.createElement('div');
      meta.className = 'gallery-meta';
      meta.innerHTML = `<span class="badge ${item.kind}">${item.kind}</span> <strong>${escapeHtml(item.model)}</strong><br><small>${escapeHtml((item.prompt || '').slice(0, 140))}</small>`;
      card.append(meta);
      if (item.kind === 'image') {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = item.prompt || item.filename;
        img.src = `/api/gallery/${item.id}/raw`;
        card.append(img);
      } else {
        const v = document.createElement('video');
        v.src = `/api/gallery/${item.id}/raw`;
        v.controls = true;
        v.preload = 'metadata';
        card.append(v);
      }
      const footer = document.createElement('div');
      footer.className = 'gallery-footer';
      const size = (item.bytes_size / 1024).toFixed(1);
      const created = new Date(item.created_at * 1000).toLocaleString();
      footer.innerHTML = `<small class="muted">${size} KB · ${created}</small>`;
      const actions = document.createElement('div');
      actions.className = 'gallery-actions';
      const open = document.createElement('a');
      open.href = `/api/gallery/${item.id}/raw`;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.textContent = 'Open';
      open.className = 'icon-button';
      const dl = document.createElement('a');
      dl.href = `/api/gallery/${item.id}/raw`;
      dl.download = item.filename;
      dl.textContent = 'Download';
      dl.className = 'icon-button';
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete';
      del.className = 'icon-button danger';
      del.addEventListener('click', () => deleteGalleryItem(item.id));
      actions.append(open, dl, del);
      footer.append(actions);
      card.append(footer);
      dom.galleryGrid.append(card);
    }
  }

  async function deleteOne(name, btn) {
    if (!confirm(`DELETE ${name} from the vault? This will also clear the live env so the running app stops using it. This cannot be undone (you will need to paste the value again to restore it).`)) return;
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try {
      const r = await apiFetch(`/api/vault/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: { 'X-AION-Confirm': 'yes' },
      });
      const p = await r.json();
      if (!r.ok) throw new Error(detail(p, r));
      showToast(`Deleted ${name} from vault`);
      await refreshVault();
    } catch (error) { showToast('Delete failed: ' + error.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Delete'; } }
  }

  async function deleteGalleryItem(itemId) {
    if (!confirm('Delete this item from the gallery?')) return;
    try {
      const r = await apiFetch(`/api/gallery/${itemId}`, { method: 'DELETE' });
      const p = await r.json();
      if (!r.ok) throw new Error(detail(p, r));
      await refreshGallery();
    } catch (error) {
      showToast('Delete failed: ' + error.message);
    }
  }

  // ===========================================================================
  // Vault tab — admin-only. List / ping / reveal / rotate encrypted secrets
  // ===========================================================================

  // ----- top-level entry points so app-boot.js's tab-bar can call them -----
  // (these used to be wired to legacy #openVault / #openNotes buttons that
  // no longer exist after the v2.8.0 tab-bar refactor. Re-exposing them at
  // the top level fixes the "loading never starts" bug on the Vault and
  // Notes dialogs.)

  function openVaultDialog() {
    if (!dom.vaultDialog) return;
    if (!dom.vaultDialog.open) dom.vaultDialog.showModal();
    refreshVault();
  }

  function openGithubDialog() {
    if (!dom.githubDialog) return;
    if (!dom.githubDialog.open) dom.githubDialog.showModal();
  }

  // ----- vault pill-tab wiring (replaces the old <select> filter) -----
  function setVaultCategory(cat) {
    // Mark active tab
    document.querySelectorAll('.vault-tab').forEach((btn) => {
      const active = (btn.dataset.vaultCat || '') === cat;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    // Drive the legacy hidden <select> so refreshVault() (which reads
    // dom.vaultFilter.value) still works without refactoring the data flow.
    if (dom.vaultFilter) dom.vaultFilter.value = cat;
    refreshVault();
  }
  function bindVaultTabs() {
    document.querySelectorAll('.vault-tab').forEach((btn) => {
      btn.addEventListener('click', () => setVaultCategory(btn.dataset.vaultCat || ''));
    });
  }

  async function refreshVault() {
    if (!dom.vaultList) return;
    dom.vaultStatus.textContent = 'Loading…';
    try {
      const cat = dom.vaultFilter.value;
      const q = cat ? `?category=${encodeURIComponent(cat)}` : '';
      const response = await apiFetch('/api/vault' + q);
      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 403) {
          dom.vaultStatus.textContent = 'Admin required to view the vault.';
          dom.vaultList.replaceChildren();
          const empty = document.createElement('p');
          empty.className = 'code-empty-state';
          empty.innerHTML = '<strong>Admin required.</strong> Your AION key is not an admin key. The vault is admin-only — set <code>AION_ADMIN_KEYS</code> on the backend to access it from this client.';
          dom.vaultList.append(empty);
          return;
        }
        throw new Error(detail(payload, response));
      }
      renderVault(payload.items || []);
      const ok = (payload.items || []).filter(i => i.has_value).length;
      const total = (payload.items || []).length;
      const known = payload.known_keys || 0;
      dom.vaultStatus.textContent = `${ok}/${total} configured (${known} known)`;
    } catch (error) {
      dom.vaultStatus.textContent = 'Error: ' + error.message;
    }
  }

  function renderVault(items) {
    dom.vaultList.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'code-empty-state';
      empty.innerHTML = 'No keys in the vault yet. Set <code>AION_VAULT_MASTER_KEY</code> or <code>AION_ADMIN_KEYS</code>, then POST <code>/api/vault/{name}/rotate</code>.';
      dom.vaultList.append(empty);
      return;
    }
    for (const item of items) {
      const status = item.last_ping_status
        ? (item.last_ping_status === 'ok' ? 'ok' : (item.last_ping_status === 'error' ? 'err' : 'pending'))
        : 'unconfigured';
      const statusLabel = `${item.last_ping_status || 'unconfigured'}${item.last_ping_latency_ms != null ? ' · ' + item.last_ping_latency_ms + 'ms' : ''}`;
      const fp = item.fingerprint || '—';
      const len = item.has_value ? `${item.value_length} chars` : 'not set';
      const src = item.source || 'unset';
      const rot = item.last_rotated_at
        ? new Date(item.last_rotated_at * 1000).toLocaleString() + (item.last_rotated_by ? ' by ' + item.last_rotated_by : '')
        : 'never';

      // Build the card with explicit DOM nodes (avoids the inline-HTML
      // string-template footgun the old version had).
      const card = document.createElement('article');
      card.className = 'vault-card';
      card.setAttribute('data-vault-name', item.name);

      // Header: name (left) + meta (right)
      const head = document.createElement('header');
      head.className = 'vault-card-head';
      const idEl = document.createElement('span');
      idEl.className = 'vault-card-id';
      idEl.textContent = item.name;
      head.append(idEl);
      const meta = document.createElement('span');
      meta.className = 'vault-card-meta';
      const catChip = document.createElement('span');
      catChip.className = 'chip';
      catChip.textContent = item.category;
      const ping = document.createElement('span');
      ping.className = `ping-status ${status}`;
      ping.textContent = statusLabel;
      meta.append(catChip, ping);
      head.append(meta);
      card.append(head);

      // Body: label + description
      const body = document.createElement('div');
      body.className = 'vault-card-body';
      const title = document.createElement('p');
      title.innerHTML = `<strong>${escapeHtml(item.label)}</strong>`;
      body.append(title);
      const desc = document.createElement('p');
      desc.textContent = item.description;
      body.append(desc);
      const metaLine = document.createElement('p');
      metaLine.style.fontSize = '11px';
      metaLine.style.fontFamily = 'var(--mono)';
      metaLine.style.color = 'var(--muted)';
      metaLine.textContent = `fingerprint ${fp} · ${len} · source=${src} · rotated ${rot}`;
      body.append(metaLine);
      if (item.last_ping_error) {
        const err = document.createElement('p');
        err.style.color = 'var(--danger)';
        err.style.fontSize = '11px';
        err.style.fontFamily = 'var(--mono)';
        err.textContent = 'last ping: ' + item.last_ping_error;
        body.append(err);
      }
      card.append(body);

      // Actions
      const actions = document.createElement('div');
      actions.className = 'vault-card-actions';
      if (item.has_value) {
        const pingBtn = document.createElement('button');
        pingBtn.type = 'button';
        pingBtn.textContent = 'Ping';
        pingBtn.addEventListener('click', () => pingOne(item.name, pingBtn));
        actions.append(pingBtn);
        const revealBtn = document.createElement('button');
        revealBtn.type = 'button';
        revealBtn.textContent = 'Reveal';
        revealBtn.addEventListener('click', () => revealOne(item.name, revealBtn));
        actions.append(revealBtn);
      }
      const rotateBtn = document.createElement('button');
      rotateBtn.type = 'button';
      rotateBtn.textContent = 'Rotate';
      rotateBtn.className = 'primary-button cta';
      rotateBtn.style.minInlineSize = '88px';
      rotateBtn.addEventListener('click', () => rotateOne(item.name, rotateBtn));
      actions.append(rotateBtn);
      if (item.has_value) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = 'Delete';
        delBtn.className = 'danger';
        delBtn.addEventListener('click', () => deleteOne(item.name, delBtn));
        actions.append(delBtn);
      }
      card.append(actions);
      dom.vaultList.append(card);
    }
  }

  async function pingOne(name, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try {
      const r = await apiFetch(`/api/vault/${encodeURIComponent(name)}/ping`, { method: 'POST' });
      const p = await r.json();
      if (!r.ok) throw new Error(detail(p, r));
      showToast(`${name}: ${p.ok ? 'OK' : 'ERR'} (${p.latency_ms || 0}ms)${p.error ? ' — ' + p.error : ''}`);
      await refreshVault();
    } catch (error) { showToast('Ping failed: ' + error.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Ping'; } }
  }

  async function revealOne(name, btn) {
    if (!confirm(`Reveal the plaintext value of ${name}? This is logged and audit-traced.`)) return;
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try {
      const r = await apiFetch(`/api/vault/${encodeURIComponent(name)}/reveal`, {
        method: 'POST',
        headers: { 'X-AION-Confirm': 'yes' },
      });
      const p = await r.json();
      if (!r.ok) throw new Error(detail(p, r));
      try { await navigator.clipboard.writeText(p.value); } catch {}
      alert(`${name}\n\n${p.value}\n\n(copied to clipboard where possible)`);
    } catch (error) { showToast('Reveal failed: ' + error.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Reveal'; } }
  }

  async function rotateOne(name, btn) {
    const value = prompt(`Paste the new value for ${name}. It will be encrypted at rest, the live env will be hot-reloaded, and the previous value discarded.`);
    if (!value) return;
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try {
      const r = await apiFetch(`/api/vault/${encodeURIComponent(name)}/rotate`, {
        method: 'POST',
        headers: { 'X-AION-Confirm': 'yes' },
        body: JSON.stringify({ value }),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(detail(p, r));
      showToast(`Rotated ${name} → fingerprint ${p.entry.fingerprint}`);
      await refreshVault();
    } catch (error) { showToast('Rotate failed: ' + error.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Rotate'; } }
  }

  async function pingAllVault() {
    if (!confirm('Ping every configured vault key in parallel? Each call hits the live provider.')) return;
    dom.vaultStatus.textContent = 'Pinging all…';
    try {
      const r = await apiFetch('/api/vault/ping', { method: 'POST' });
      const p = await r.json();
      if (!r.ok) throw new Error(detail(p, r));
      const s = p.summary;
      showToast(`Pings done: ${s.ok}/${s.total} OK, ${s.error} errors`);
      await refreshVault();
    } catch (error) { showToast('Ping-all failed: ' + error.message); }
  }

  // escapeHtml is shared from app-core.js (loads before this file).

  function bindGalleryVaultEvents() {
    // The Vault tab is opened via the data-action="vault" tab-bar element
    // (sidebar + mobile). The tab-bar's openTab() now calls
    // openVaultDialog() — we don't wire a click handler here because that
    // path is already taken (see app-boot.js TAB_ACTIONS.vault).
    if (dom.vaultRefresh) dom.vaultRefresh.addEventListener('click', refreshVault);
    if (dom.vaultPingAll) dom.vaultPingAll.addEventListener('click', pingAllVault);
    if (dom.vaultFilter) dom.vaultFilter.addEventListener('change', refreshVault);
    if (dom.galleryRefresh) dom.galleryRefresh.addEventListener('click', refreshGallery);
    if (dom.galleryFilter) dom.galleryFilter.addEventListener('change', refreshGallery);
    // Pill tabs replace the old <select> filter
    bindVaultTabs();
  }
