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

  function openVaultDialog() {
    if (!dom.vaultDialog) return;
    if (!dom.vaultDialog.open) dom.vaultDialog.showModal();
    refreshVault();
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
          const p = document.createElement('p');
          p.className = 'muted';
          p.textContent = 'Your AION key is not an admin key. The vault is admin-only.';
          dom.vaultList.append(p);
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
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No keys in the vault yet. Set AION_VAULT_MASTER_KEY or AION_ADMIN_KEYS, then POST /api/vault/{name}/rotate.';
      dom.vaultList.append(p);
      return;
    }
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'vault-row';
      const header = document.createElement('div');
      header.className = 'vault-row-header';
      const status = item.last_ping_status
        ? (item.last_ping_status === 'ok' ? 'ok' : (item.last_ping_status === 'error' ? 'err' : 'pending'))
        : 'unconfigured';
      header.innerHTML = `
        <span class="badge ${item.category}">${escapeHtml(item.category)}</span>
        <strong>${escapeHtml(item.label)}</strong>
        <code>${escapeHtml(item.name)}</code>
        <span class="ping-status ${status}">${item.last_ping_status || 'unconfigured'}${item.last_ping_latency_ms != null ? ' · ' + item.last_ping_latency_ms + 'ms' : ''}</span>
      `;
      row.append(header);
      const desc = document.createElement('p');
      desc.className = 'muted';
      desc.textContent = item.description;
      row.append(desc);
      const meta = document.createElement('p');
      meta.className = 'muted small';
      const fp = item.fingerprint || '—';
      const len = item.has_value ? `${item.value_length} chars` : 'not set';
      const src = item.source || 'unset';
      const rot = item.last_rotated_at ? new Date(item.last_rotated_at * 1000).toLocaleString() + (item.last_rotated_by ? ' by ' + item.last_rotated_by : '') : 'never';
      meta.textContent = `fingerprint ${fp} · ${len} · source=${src} · rotated ${rot}`;
      row.append(meta);
      if (item.last_ping_error) {
        const err = document.createElement('p');
        err.className = 'muted small error';
        err.textContent = 'last ping: ' + item.last_ping_error;
        row.append(err);
      }
      const actions = document.createElement('div');
      actions.className = 'gallery-actions';
      if (item.has_value) {
        const ping = document.createElement('button');
        ping.type = 'button';
        ping.textContent = 'Ping';
        ping.className = 'icon-button';
        ping.addEventListener('click', () => pingOne(item.name, ping));
        const reveal = document.createElement('button');
        reveal.type = 'button';
        reveal.textContent = 'Reveal';
        reveal.className = 'icon-button';
        reveal.addEventListener('click', () => revealOne(item.name, reveal));
        actions.append(ping, reveal);
      }
      const rotate = document.createElement('button');
      rotate.type = 'button';
      rotate.textContent = 'Rotate';
      rotate.className = 'icon-button primary';
      rotate.addEventListener('click', () => rotateOne(item.name, rotate));
      actions.append(rotate);
      if (item.has_value) {
        const del = document.createElement('button');
        del.type = 'button';
        del.textContent = 'Delete';
        del.className = 'icon-button danger';
        del.addEventListener('click', () => deleteOne(item.name, del));
        actions.append(del);
      }
      row.append(actions);
      dom.vaultList.append(row);
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

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function bindGalleryVaultEvents() {
    if (dom.openVault) dom.openVault.addEventListener('click', openVaultDialog);
    if (dom.vaultRefresh) dom.vaultRefresh.addEventListener('click', refreshVault);
    if (dom.vaultPingAll) dom.vaultPingAll.addEventListener('click', pingAllVault);
    if (dom.vaultFilter) dom.vaultFilter.addEventListener('change', refreshVault);
    if (dom.galleryRefresh) dom.galleryRefresh.addEventListener('click', refreshGallery);
    if (dom.galleryFilter) dom.galleryFilter.addEventListener('change', refreshGallery);
  }
