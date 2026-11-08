// Shared by every page outside the Recruitment board (public/index.html keeps
// its own copy of this logic — it was built, verified and shipped first, and
// duplicating it here is safer than refactoring working code to share it).
const ACCESS_KEY_STORAGE = 'csb-access-key';

function getAccessKey(){
  try{ return localStorage.getItem(ACCESS_KEY_STORAGE) || ''; }catch(e){ return ''; }
}
function clearAccessKey(){
  try{ localStorage.removeItem(ACCESS_KEY_STORAGE); }catch(e){ /* ignore */ }
}

// There's no key-entry UI on these pages — that lives on the board
// (index.html) and is reused as the single entry point until the real
// per-user login replaces this shared-key stopgap.
function requireAccessKeyOrRedirect(){
  if(!getAccessKey()){
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

async function apiFetch(url, options){
  const opts = Object.assign({}, options);
  opts.headers = Object.assign({}, opts.headers, { 'x-access-key': getAccessKey() });
  const res = await fetch(url, opts);
  if(res.status === 401){
    clearAccessKey();
    window.location.href = 'index.html';
  }
  return res;
}

function escapeHtml(str){
  if(str===undefined || str===null) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function currentRole(){
  try{ return localStorage.getItem('csb-ui-role') || 'hr'; }catch(e){ return 'hr'; }
}
function currentUserLabel(){
  return currentRole() === 'ceo' ? 'CEO' : 'Nesma Shalaby, HR Executive';
}

function showToast(msg){
  let t = document.getElementById('sharedToast');
  if(!t){
    t = document.createElement('div');
    t.id = 'sharedToast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}
