  'use strict';

  function openMediaDialog() {
    if (!dom.mediaDialog.open) dom.mediaDialog.showModal();
  }

  function setMediaTab(name) {
    document.querySelectorAll('.media-tab').forEach((tab) => {
      const active = tab.dataset.mediaTab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.media-panel').forEach((panel) => {
      panel.hidden = panel.dataset.mediaPanel !== name;
    });
  }

  async function speakText() {
    const text = dom.ttsText.value.trim();
    if (!text) { showToast('Enter some text first.'); return; }
    const voice = dom.ttsVoice.value;
    dom.ttsStatus.textContent = 'Generating…';
    dom.ttsSpeak.disabled = true;
    try {
      const response = await apiFetch('/api/tts', { method: 'POST', body: JSON.stringify({ text, voice, format: 'mp3' }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(detail(payload, response));
      if (payload.ok === false) {
        if ('speechSynthesis' in window) {
          const utter = new SpeechSynthesisUtterance(text);
          utter.rate = 1;
          window.speechSynthesis.speak(utter);
          dom.ttsStatus.textContent = payload.error ? `Browser speech (server: ${payload.error})` : 'Browser speech';
        } else {
          dom.ttsStatus.textContent = 'TTS unavailable: ' + (payload.error || 'no backend key');
        }
        return;
      }
      const audioB64 = payload.audio_b64;
      const audioBytes = Uint8Array.from(atob(audioB64), (c) => c.charCodeAt(0));
      const blob = new Blob([audioBytes], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      dom.ttsAudio.src = url;
      dom.ttsAudio.hidden = false;
      await dom.ttsAudio.play().catch(() => {});
      dom.ttsStatus.textContent = 'Spoke with ' + (payload.voice || voice) + ' (' + (payload.size_bytes || 0) + ' bytes)';
    } catch (error) {
      dom.ttsStatus.textContent = 'Error: ' + error.message;
    } finally {
      dom.ttsSpeak.disabled = false;
    }
  }

  async function generateImage() {
    const prompt = dom.imagePrompt.value.trim();
    if (!prompt) { showToast('Describe the image first.'); return; }
    const model = dom.imageModel.value;
    const size = dom.imageSize.value;
    dom.imageStatus.textContent = 'Generating… (this can take 10-30s)';
    dom.imageGenerate.disabled = true;
    try {
      const response = await apiFetch('/api/image/generate', { method: 'POST', body: JSON.stringify({ prompt, model, size, n: 1 }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(detail(payload, response));
      if (payload.ok === false) {
        dom.imageStatus.textContent = 'Image gen unavailable: ' + (payload.error || 'unknown');
        return;
      }
      dom.imageGallery.replaceChildren();
      for (const item of payload.items || []) {
        const wrap = document.createElement('div');
        wrap.className = 'image-card';
        if (item.b64_json) {
          const img = document.createElement('img');
          img.src = 'data:image/png;base64,' + item.b64_json;
          img.alt = prompt;
          wrap.append(img);
        } else if (item.url) {
          const a = document.createElement('a');
          a.href = item.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = 'Open image';
          wrap.append(a);
        }
        if (item.revised_prompt) {
          const note = document.createElement('small');
          note.textContent = item.revised_prompt;
          wrap.append(note);
        }
        const dl = document.createElement('button');
        dl.type = 'button';
        dl.textContent = 'Download';
        dl.className = 'icon-button';
        if (item.b64_json) {
          dl.addEventListener('click', () => downloadB64(item.b64_json, 'aion-image.png'));
        }
        wrap.append(dl);
        dom.imageGallery.append(wrap);
      }
      dom.imageStatus.textContent = 'Generated ' + payload.count + ' image(s) with ' + payload.model;
    } catch (error) {
      dom.imageStatus.textContent = 'Error: ' + error.message;
    } finally {
      dom.imageGenerate.disabled = false;
    }
  }

  async function generateVideo() {
    const prompt = dom.videoPrompt.value.trim();
    if (!prompt) { showToast('Describe the video first.'); return; }
    const seconds = Number(dom.videoSeconds.value);
    const size = dom.videoSize.value;
    const poll = dom.videoPoll.checked;
    dom.videoStatus.textContent = poll ? 'Submitting and waiting (up to 2 min)…' : 'Submitting…';
    dom.videoGenerate.disabled = true;
    try {
      const response = await apiFetch('/api/video/generate', { method: 'POST', body: JSON.stringify({ prompt, model: 'sora-2', seconds, size, poll, poll_timeout_seconds: 120 }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(detail(payload, response));
      if (payload.ok === false) {
        if (payload.fallback === 'image_to_video') {
          dom.videoStatus.textContent = 'Video API unavailable (' + payload.reason + '). Use image-to-video flow.';
        } else {
          dom.videoStatus.textContent = 'Error: ' + (payload.error || 'unknown');
        }
        return;
      }
      if (payload.status && payload.status !== 'completed') {
        dom.videoStatus.textContent = 'Job ' + payload.status + ' (video_id=' + payload.video_id + '). Poll /api/video/' + payload.video_id + ' for status.';
        return;
      }
      if (payload.mp4_b64) {
        const mp4Bytes = Uint8Array.from(atob(payload.mp4_b64), (c) => c.charCodeAt(0));
        const blob = new Blob([mp4Bytes], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        dom.videoOutput.src = url;
        dom.videoOutput.hidden = false;
        await dom.videoOutput.play().catch(() => {});
        const dl = document.createElement('a');
        dl.href = url;
        dl.download = 'aion-video.mp4';
        dl.textContent = 'Download MP4';
        dl.style.marginLeft = '10px';
        dom.videoOutput.parentNode.append(dl);
        dom.videoStatus.textContent = 'Rendered ' + payload.size_bytes + ' bytes (' + payload.seconds + 's @ ' + payload.size + ')';
      } else {
        dom.videoStatus.textContent = 'Job created: ' + payload.video_id;
      }
    } catch (error) {
      dom.videoStatus.textContent = 'Error: ' + error.message;
    } finally {
      dom.videoGenerate.disabled = false;
    }
  }

  function downloadB64(b64, filename) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bindMediaEvents() {
    if (dom.openMedia) dom.openMedia.addEventListener('click', openMediaDialog);
    document.querySelectorAll('.media-tab').forEach((tab) => {
      tab.addEventListener('click', () => setMediaTab(tab.dataset.mediaTab));
    });
    if (dom.ttsSpeak) dom.ttsSpeak.addEventListener('click', speakText);
    if (dom.imageGenerate) dom.imageGenerate.addEventListener('click', generateImage);
    if (dom.videoGenerate) dom.videoGenerate.addEventListener('click', generateVideo);
  }
