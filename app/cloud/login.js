document.getElementById('login').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('button'), error = document.getElementById('error');
  button.disabled = true; error.textContent = '';
  try {
    const response = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    form.reset(); location.replace('/');
  } catch (e) { error.textContent = e.message || '无法登录，请稍后重试'; }
  finally { button.disabled = false; }
});
