// ==========================================
// CONFIGURATION
// ==========================================
// Your public tunnel address (changes whenever cloudflared restarts). No trailing slash.
const API_BASE = "https://airfare-desktops-regression-liability.trycloudflare.com/webhook";

// Configure PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ==========================================
// HELPERS
// ==========================================
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const arr = (v) => Array.isArray(v) ? v : [];

// ==========================================
// STATE
// ==========================================
let state = {
  files: {
    competency: [],
    materials: [],
    eloFormat: [],
    ppst: []
  },
  isGenerating: false,
  currentResult: null
};

// ==========================================
// DOM ELEMENTS
// ==========================================
const views = {
  dashboard: document.getElementById('view-dashboard'),
  generator: document.getElementById('view-generator'),
  results: document.getElementById('view-results')
};
const loadingOverlay = document.getElementById('loadingOverlay');
const toastEl = document.getElementById('toast');
const planForm = document.getElementById('planForm');
const formAlert = document.getElementById('formAlert');

// ==========================================
// NAVIGATION
// ==========================================
function switchView(viewName) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[viewName].classList.remove('hidden');
  window.scrollTo(0, 0);
  if (viewName === 'dashboard') renderRecent();
}

document.querySelectorAll('[data-nav]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    switchView(btn.dataset.nav);
  });
});
document.getElementById('brandHome').addEventListener('click', () => switchView('dashboard'));
document.getElementById('scrollToInstructions').addEventListener('click', () => {
  document.getElementById('instructions').scrollIntoView({ behavior: 'smooth' });
});

// ==========================================
// TOAST & ALERTS
// ==========================================
function showToast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className = `toast ${type}`;
  toastEl.classList.remove('hidden');
  setTimeout(() => toastEl.classList.add('show'), 10);
  setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => toastEl.classList.add('hidden'), 300);
  }, 3000);
}

function showAlert(msg, type = 'error') {
  formAlert.textContent = msg;
  formAlert.className = `alert ${type}`;
  formAlert.classList.remove('hidden');
}
function hideAlert() {
  formAlert.classList.add('hidden');
}

// ==========================================
// FILE UPLOAD & PROCESSING
// ==========================================
document.querySelectorAll('.dropzone').forEach(zone => {
  const input = zone.querySelector('input[type="file"]');
  const type = zone.dataset.drop;

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragover');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files, type);
  });

  input.addEventListener('change', (e) => {
    handleFiles(e.target.files, type);
    input.value = ''; // reset
  });
});

async function handleFiles(files, type) {
  const fileArray = Array.from(files);
  const isMultiple = type === 'materials';

  if (!isMultiple && fileArray.length > 0) {
    // Replace existing if not multiple
    state.files[type] = [];
  }

  for (const file of fileArray) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt', 'doc'].includes(ext)) {
      showToast(`Unsupported file type: .${ext}`, 'error');
      continue;
    }

    const fileObj = {
      id: Math.random().toString(36).substr(2, 9),
      file: file,
      name: file.name,
      size: file.size,
      text: '',
      error: null,
      loading: true
    };

    if (!isMultiple) {
      state.files[type] = [fileObj];
    } else {
      state.files[type].push(fileObj);
    }

    renderFileList(type);
    processFile(fileObj);
  }
}

async function processFile(fileObj) {
  const ext = fileObj.file.name.split('.').pop().toLowerCase();
  try {
    if (ext === 'pdf') {
      fileObj.text = await extractPDF(fileObj.file);
    } else if (ext === 'docx') {
      fileObj.text = await extractDOCX(fileObj.file);
    } else if (ext === 'txt') {
      fileObj.text = await extractTXT(fileObj.file);
    } else if (ext === 'doc') {
      // Basic fallback for .doc, might have binary junk but we try
      fileObj.text = await extractTXT(fileObj.file);
    }
  } catch (err) {
    fileObj.error = err.message || 'Failed to extract text';
  }

  fileObj.loading = false;

  // Find which type this belongs to and re-render
  for (const type in state.files) {
    if (state.files[type].some(f => f.id === fileObj.id)) {
      renderFileList(type);
    }
  }
}

async function extractPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  if (!text.trim()) throw new Error('Document appears to be scanned images. OCR is required.');
  return text;
}

async function extractDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  if (!result.value.trim()) throw new Error('Document appears to be empty.');
  return result.value;
}

function extractTXT(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      if (!text.trim()) reject(new Error('Document appears to be empty.'));
      else resolve(text);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// ==========================================
// RENDER FILE LISTS
// ==========================================
function renderFileList(type) {
  const listEl = document.querySelector(`[data-list="${type}"]`);
  if (!listEl) return;
  listEl.innerHTML = '';

  state.files[type].forEach(fileObj => {
    const li = document.createElement('li');
    li.className = 'file-item';

    const head = document.createElement('div');
    head.className = 'file-item-head';

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = fileObj.name;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'file-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = () => {
      state.files[type] = state.files[type].filter(f => f.id !== fileObj.id);
      renderFileList(type);
    };

    head.appendChild(name);
    head.appendChild(removeBtn);
    li.appendChild(head);

    if (fileObj.loading) {
      const meta = document.createElement('div');
      meta.className = 'file-meta';
      meta.textContent = 'Extracting text...';
      li.appendChild(meta);
    } else if (fileObj.error) {
      const warn = document.createElement('div');
      warn.className = 'file-warning';
      warn.textContent = `⚠ ${fileObj.error}`;
      li.appendChild(warn);
    } else {
      const meta = document.createElement('div');
      meta.className = 'file-meta';

      const len = document.createElement('span');
      len.textContent = `${fileObj.text.length.toLocaleString()} characters extracted`;

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'file-preview-toggle';
      toggle.textContent = 'Review Text';

      const preview = document.createElement('div');
      preview.className = 'file-preview-text';
      preview.textContent = fileObj.text;

      toggle.onclick = () => {
        preview.classList.toggle('show');
        toggle.textContent = preview.classList.contains('show') ? 'Hide Text' : 'Review Text';
      };

      meta.appendChild(len);
      meta.appendChild(toggle);
      li.appendChild(meta);
      li.appendChild(preview);
    }

    listEl.appendChild(li);
  });
}

// ==========================================
// BACKEND: START JOB, THEN CHECK BACK
// ==========================================
async function requestLessonPlan(payload) {
  // 1. Start the job. n8n replies right away with a job ID.
  const startRes = await fetch(`${API_BASE}/lessonplan-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const job = await startRes.json().catch(() => ({}));
  if (!startRes.ok || !job.ok) {
    throw new Error(job.error || `Server returned ${startRes.status}`);
  }

  // 2. Check back every few seconds until the result is ready.
  const deadline = Date.now() + 6 * 60 * 1000; // give up after 6 minutes
  let failures = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const res = await fetch(`${API_BASE}/lessonplan-status?jobId=${encodeURIComponent(job.jobId)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `Status check failed (${res.status})`);
      if (data.status === 'done') return data.workbookData;
      failures = 0;
    } catch (err) {
      failures++;
      if (failures >= 4) throw err; // tolerate brief network hiccups
    }
  }
  throw new Error('This is taking longer than expected');
}

// ==========================================
// FORM VALIDATION & SUBMISSION
// ==========================================
document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('Clear all fields and uploaded files?')) {
    planForm.reset();
    state.files = { competency: [], materials: [], eloFormat: [], ppst: [] };
    ['competency', 'materials', 'eloFormat', 'ppst'].forEach(renderFileList);
    hideAlert();
    document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
    document.querySelectorAll('.field input').forEach(el => el.classList.remove('error'));
  }
});

planForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.isGenerating) return;

  hideAlert();
  let isValid = true;

  // 1. Validate General Info
  const fields = ['gradeLevel', 'subject', 'topic', 'lessonDuration'];
  fields.forEach(f => {
    const input = document.getElementById(f);
    const errEl = document.querySelector(`[data-error-for="${f}"]`);
    if (!input.value.trim()) {
      input.classList.add('error');
      errEl.textContent = 'This field is required.';
      isValid = false;
    } else {
      input.classList.remove('error');
      errEl.textContent = '';
    }
  });

  // 2. Validate Files
  const fileTypes = {
    competency: 'Learning Competency',
    materials: 'Actual Lesson Materials',
    eloFormat: 'Required ELO Format',
    ppst: 'PPST/COT Indicators'
  };

  for (const [type, label] of Object.entries(fileTypes)) {
    const files = state.files[type];
    if (files.length === 0) {
      showAlert(`Please upload the ${label} document.`);
      isValid = false;
      break;
    }
    if (files.some(f => f.error)) {
      showAlert(`There is an error extracting text from one of the ${label} files. Please replace it.`);
      isValid = false;
      break;
    }
    if (files.some(f => f.loading)) {
      showAlert(`Please wait for the ${label} file to finish extracting text.`);
      isValid = false;
      break;
    }
  }

  if (!isValid) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  // 3. Prepare Payload
  const payload = {
    gradeLevel: document.getElementById('gradeLevel').value.trim(),
    subject: document.getElementById('subject').value.trim(),
    topic: document.getElementById('topic').value.trim(),
    lessonDuration: document.getElementById('lessonDuration').value.trim(),
    competency: state.files.competency.map(f => f.text).join('\n\n'),
    lessonMaterials: state.files.materials.map(f => f.text).join('\n\n'),
    eloFormat: state.files.eloFormat.map(f => f.text).join('\n\n'),
    ppstIndicators: state.files.ppst.map(f => f.text).join('\n\n')
  };

  // 4. Submit
  state.isGenerating = true;
  const btn = document.getElementById('generateBtn');
  const btnLabel = btn.querySelector('.btn-label');
  const originalLabel = btnLabel.textContent;
  btnLabel.textContent = 'Generating...';
  btn.disabled = true;
  loadingOverlay.classList.remove('hidden');

  try {
    const data = await requestLessonPlan(payload);

    // Keep only small metadata (not the full uploaded text) for history
    const meta = {
      gradeLevel: payload.gradeLevel,
      subject: payload.subject,
      topic: payload.topic,
      lessonDuration: payload.lessonDuration
    };
    state.currentResult = { data, meta, savedAt: Date.now() };
    try { saveToHistory(state.currentResult); } catch (e) { console.warn('History not saved', e); }

    // Render results
    renderResults(state.currentResult);
    switchView('results');
    showToast('Lesson plan generated successfully!', 'success');

  } catch (err) {
    console.error(err);
    showAlert(`Generation failed: ${err.message}. Please check your connection and try again.`);
  } finally {
    state.isGenerating = false;
    btnLabel.textContent = originalLabel;
    btn.disabled = false;
    loadingOverlay.classList.add('hidden');
  }
});

// ==========================================
// RESULTS RENDERING
// ==========================================
function renderResults({ data, meta }) {
  data = data.workbookData || data; // tolerate older saved items

  document.getElementById('resultMeta').innerHTML =
    [meta.gradeLevel, meta.subject, meta.topic, meta.lessonDuration]
      .map(v => `<span class="meta-chip">${esc(v)}</span>`).join('');

  const lessonPlan = arr(data.lesson_plan);
  const elos = arr(data.elos);
  const alignment = arr(data.alignment);
  const checks = arr(data.quality_checks);
  const notes = arr(data.teacher_review_notes);
  const none = (what) => `<div class="result-card"><p class="muted">No ${what} returned.</p></div>`;

  // 1. ILAW lesson plan
  let lpHTML = `<div class="result-section"><h2>ILAW Lesson Plan</h2>`;
  lpHTML += lessonPlan.length
    ? lessonPlan.map(s => `
        <div class="result-card">
          <h3>${esc(s.section)}</h3>
          <p>${esc(s.content).replace(/\n/g, '<br>')}</p>
        </div>`).join('')
    : none('lesson plan data');
  lpHTML += `</div>`;

  // 2. Expected Learning Outcomes
  let eloHTML = `<div class="result-section"><h2>Expected Learning Outcomes</h2>`;
  eloHTML += elos.length
    ? `<div class="table-responsive"><table><thead><tr><th>Code</th><th>Outcome</th><th>Assessment</th></tr></thead><tbody>
        ${elos.map(e => `<tr>
          <td><strong>${esc(e.code)}</strong></td>
          <td>${esc(e.outcome)}</td>
          <td>${esc(e.assessment)}</td>
        </tr>`).join('')}
      </tbody></table></div>`
    : none('ELO data');
  eloHTML += `</div>`;

  // 3. PPST/COT alignment
  let ppstHTML = `<div class="result-section"><h2>PPST/COT Alignment Matrix</h2>`;
  ppstHTML += alignment.length
    ? `<div class="table-responsive"><table><thead><tr><th>Indicator</th><th>Lesson Component</th><th>Observable Evidence</th><th>Status</th></tr></thead><tbody>
        ${alignment.map(r => `<tr>
          <td>${esc(r.indicator)}</td>
          <td>${esc(r.lesson_component)}</td>
          <td>${esc(r.evidence)}</td>
          <td><span class="status ${String(r.status).toLowerCase().includes('addressed') ? 'aligned' : 'partial'}">${esc(r.status)}</span></td>
        </tr>`).join('')}
      </tbody></table></div>`
    : none('PPST/COT data');
  ppstHTML += `</div>`;

  // 4. Quality checks
  let qcHTML = `<div class="result-section"><h2>Quality Checks</h2><div class="quality-grid">`;
  qcHTML += checks.length
    ? checks.map(c => `
        <div class="q-check">
          <h4>${esc(c.check)}</h4>
          <div class="q-status">${esc(c.result)}</div>
          <p class="muted">${esc(c.notes)}</p>
        </div>`).join('')
    : `<div class="q-check"><p class="muted">No quality check data returned.</p></div>`;
  qcHTML += `</div></div>`;

  // 5. Teacher review notes
  let noteHTML = `<div class="result-section"><h2>Teacher Review Notes</h2>`;
  noteHTML += notes.length
    ? `<div class="result-card"><ul>${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`
    : none('review notes');
  noteHTML += `</div>`;

  document.getElementById('resultsBody').innerHTML = lpHTML + eloHTML + ppstHTML + qcHTML + noteHTML;
}

// ==========================================
// EXCEL EXPORT
// ==========================================
document.getElementById('downloadBtn').addEventListener('click', () => {
  if (!state.currentResult) return;
  let { data, meta } = state.currentResult;
  data = data.workbookData || data;

  const sheet = (rows, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map(w => ({ wch: w }));
    return ws;
  };

  const ws1 = sheet(
    [["ILAW Lesson Plan Section", "Lesson Content / Activities"],
     ...arr(data.lesson_plan).map(s => [s.section || '', s.content || ''])],
    [30, 80]);

  const ws2 = sheet(
    [["ELO Code", "Expected Learning Outcome", "Assessment Method"],
     ...arr(data.elos).map(e => [e.code || '', e.outcome || '', e.assessment || ''])],
    [15, 60, 40]);

  const ws3 = sheet(
    [["Exact Indicator", "Lesson Component", "Observable Evidence", "Alignment Status"],
     ...arr(data.alignment).map(r => [r.indicator || '', r.lesson_component || '', r.evidence || '', r.status || ''])],
    [40, 30, 50, 20]);

  const ws4 = sheet(
    [["Check", "Result", "Notes"],
     ...arr(data.quality_checks).map(c => [c.check || '', c.result || '', c.notes || '']),
     [],
     ["Teacher Review Notes", "", ""],
     ...arr(data.teacher_review_notes).map(n => [n, "", ""])],
    [35, 25, 80]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "ILAW Lesson Plan");
  XLSX.utils.book_append_sheet(wb, ws2, "Expected Learning Outcomes");
  XLSX.utils.book_append_sheet(wb, ws3, "PPST-COT Alignment");
  XLSX.utils.book_append_sheet(wb, ws4, "Quality & Review Notes");

  const safeSubject = (meta.subject || 'Subject').replace(/[^a-z0-9]/gi, '_');
  const safeGrade = (meta.gradeLevel || 'Grade').replace(/[^a-z0-9]/gi, '_');
  XLSX.writeFile(wb, `LessonPlan_${safeSubject}_${safeGrade}.xlsx`);
  showToast('Excel workbook downloaded!', 'success');
});

document.getElementById('printBtn').addEventListener('click', () => {
  window.print();
});

// ==========================================
// RECENT HISTORY (LOCAL STORAGE)
// ==========================================
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem('lessonPlanHistory')) || [];
  } catch {
    return [];
  }
}

function saveToHistory(item) {
  let history = getHistory();
  history.unshift(item);
  history = history.slice(0, 10); // Keep last 10
  localStorage.setItem('lessonPlanHistory', JSON.stringify(history));
}

function renderRecent() {
  const history = getHistory();
  const list = document.getElementById('recentList');
  const clearBtn = document.getElementById('clearRecentBtn');

  list.innerHTML = '';

  if (history.length === 0) {
    list.innerHTML = '<p class="muted">No recent generations yet.</p>';
    clearBtn.classList.add('hidden');
    return;
  }

  clearBtn.classList.remove('hidden');
  clearBtn.onclick = () => {
    if (confirm('Clear all recent history?')) {
      localStorage.removeItem('lessonPlanHistory');
      renderRecent();
    }
  };

  history.forEach((item) => {
    if (!item || !item.meta) return;
    const when = item.savedAt ? new Date(item.savedAt).toLocaleDateString() : '';
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.innerHTML = `
      <div class="recent-item-info">
        <h4>${esc(item.meta.topic)}</h4>
        <span>${esc(item.meta.subject)} • ${esc(item.meta.gradeLevel)}${when ? ' • ' + esc(when) : ''}</span>
      </div>
      <button class="btn btn-ghost btn-sm">View</button>
    `;
    div.onclick = () => {
      state.currentResult = item;
      renderResults(item);
      switchView('results');
    };
    list.appendChild(div);
  });
}

// Init
renderRecent();