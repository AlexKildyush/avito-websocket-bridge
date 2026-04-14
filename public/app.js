const socket = io();

const statusEl = document.getElementById('status');
const statusDetailEl = document.getElementById('status-detail');
const messagesEl = document.getElementById('messages');

function formatDate(value) {
  return new Date(value).toLocaleString('ru-RU');
}

function setStatus(status) {
  statusEl.textContent = `Статус: ${status.state}`;
  statusEl.className = `status ${status.state}`;
  statusDetailEl.textContent = `${status.detail} • ${formatDate(status.updatedAt)}`;
}

function renderMessages(messages) {
  if (!messages.length) {
    messagesEl.innerHTML = '<div class="empty">Сообщения пока не поступали.</div>';
    return;
  }

  messagesEl.innerHTML = messages
    .map(
      (message) => `
        <article class="message">
          <div class="meta">
            <strong>${escapeHtml(message.contactName)}</strong>
            <span>${formatDate(message.receivedAt)}</span>
          </div>
          <div>${escapeHtml(message.text)}</div>
        </article>
      `,
    )
    .join('');
}

function prependMessage(message) {
  const current = Array.from(messagesEl.querySelectorAll('.message')).map((node) => node.outerHTML);
  const entry = `
    <article class="message">
      <div class="meta">
        <strong>${escapeHtml(message.contactName)}</strong>
        <span>${formatDate(message.receivedAt)}</span>
      </div>
      <div>${escapeHtml(message.text)}</div>
    </article>
  `;

  messagesEl.innerHTML = [entry, ...current].join('');
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

socket.on('connect', () => {
  socket.emit('ping', { hello: 'frontend' });
});

socket.on('bootstrap', (payload) => {
  setStatus(payload.status);
  renderMessages(payload.messages);
});

socket.on('status', (status) => {
  setStatus(status);
});

socket.on('message', (message) => {
  prependMessage(message);
});
