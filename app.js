// ==========================================
// CONFIGURATION
// ==========================================
const WEBHOOK_URL = "YOUR_N8N_PRODUCTION_WEBHOOK_URL"; // <-- CHANGE THIS

// Configure PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

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
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Save to state & history
    state.currentResult = { data, meta: payload };
    saveToHistory(state.currentResult);
    
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
  document.getElementById('resultMeta').innerHTML = `
    <span class="meta-chip">${meta.gradeLevel}</span>
    <span class="meta-chip">${meta.subject}</span>
    <span class="meta-chip">${meta.topic}</span>
    <span class="meta-chip">${meta.lessonDuration}</span>
  `;

  const container = document.getElementById('resultsBody');
  container.innerHTML = '';

  // Helper to safely extract strings/arrays
  const arr = (val) => Array.isArray(val) ? val : [];
  const str = (val) => typeof val === 'string' ? val : JSON.stringify(val || '');

  // 1. ILAW Lesson Plan
  const lessonPlan = data.lessonPlan || data.ilaw || data.lesson_plan || {};
  let lpHTML = `<div class="result-section"><h2>ILAW Lesson Plan</h2>`;
  
  if (typeof lessonPlan === 'string') {
    lpHTML += `<div class="result-card"><p>${lessonPlan.replace(/\n/g, '<br>')}</p></div>`;
  } else if (Object.keys(lessonPlan).length > 0) {
    for (const [key, val] of Object.entries(lessonPlan)) {
      lpHTML += `
        <div class="result-card">
          <h3>${key.replace(/_/g, ' ').toUpperCase()}</h3>
          <p>${str(val).replace(/\n/g, '<br>')}</p>
        </div>
      `;
    }
  } else {
    lpHTML += `<div class="result-card"><p class="muted">No lesson plan data returned.</p></div>`;
  }
  lpHTML += `</div>`;

  // 2. Expected Learning Outcomes
  const elos = arr(data.elo || data.elos || data.expectedLearningOutcomes);
  let eloHTML = `<div class="result-section"><h2>Expected Learning Outcomes</h2>`;
  if (elos.length > 0) {
    eloHTML += `<div class="table-responsive"><table><thead><tr><th>Code</th><th>Outcome</th><th>Assessment</th></tr></thead><tbody>`;
    elos.forEach(elo => {
      eloHTML += `<tr>
        <td><strong>${str(elo.code)}</strong></td>
        <td>${str(elo.outcome || elo.description)}</td>
        <td>${str(elo.assessment || elo.assessmentMethod)}</td>
      </tr>`;
    });
    eloHTML += `</tbody></table></div>`;
  } else {
    eloHTML += `<div class="result-card"><p class="muted">No ELO data returned.</p></div>`;
  }
  eloHTML += `</div>`;

  // 3. PPST/COT Matrix
  const ppst = arr(data.ppstCot || data.ppst || data.matrix);
  let ppstHTML = `<div class="result-section"><h2>PPST/COT Alignment Matrix</h2>`;
  if (ppst.length > 0) {
    ppstHTML += `<div class="table-responsive"><table><thead><tr><th>Indicator</th><th>Lesson Component</th><th>Observable Evidence</th><th>Status</th></tr></thead><tbody>`;
    ppst.forEach(row => {
      const statusClass = (str(row.status).toLowerCase().includes('align') ? 'aligned' : 'partial');
      ppstHTML += `<tr>
        <td>${str(row.indicator)}</td>
        <td>${str(row.lessonComponent || row.component)}</td>
        <td>${str(row.evidence || row.observableEvidence)}</td>
        <td><span class="status ${statusClass}">${str(row.status || 'Aligned')}</span></td>
      </tr>`;
    });
    ppstHTML += `</tbody></table></div>`;
  } else {
    ppstHTML += `<div class="result-card"><p class="muted">No PPST/COT data returned.</p></div>`;
  }
  ppstHTML += `</div>`;

  // 4. Quality Checks
  const qc = data.qualityChecks || data.quality || {};
  let qcHTML = `<div class="result-section"><h2>Quality Checks</h2><div class="quality-grid">`;
  if (Object.keys(qc).length > 0) {
    for (const [key, val] of Object.entries(qc)) {
      qcHTML += `
        <div class="q-check">
          <h4>${key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim()}</h4>
          <div class="q-status">${str(val)}</div>
        </div>
      `;
    }
  } else {
    qcHTML += `<div class="q-check"><p class="muted">No quality check data returned.</p></div>`;
  }
  qcHTML += `</div></div>`;

  container.innerHTML = lpHTML + eloHTML + ppstHTML + qcHTML;
}

// ==========================================
// EXCEL EXPORT
// ==========================================
document.getElementById('downloadBtn').addEventListener('click', () => {
  if (!state.currentResult) return;
  const { data, meta } = state.currentResult;

  // 1. Sheet: ILAW Lesson Plan
  const lessonPlanData = data.lessonPlan || data.ilaw || {};
  const ws1Data = [["ILAW Lesson Plan Section", "Lesson Content / Activities"]];
  if (typeof lessonPlanData === 'string') {
    ws1Data.push(["Full Plan", lessonPlanData]);
  } else {
    for (const [key, val] of Object.entries(lessonPlanData)) {
      ws1Data.push([key.replace(/_/g, ' ').toUpperCase(), String(val)]);
    }
  }
  const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
  ws1['!cols'] = [{ wch: 30 }, { wch: 80 }];

  // 2. Sheet: ELO
  const elos = data.elo || data.elos || data.expectedLearningOutcomes || [];
  const ws2Data = [["ELO Code", "Expected Learning Outcome", "Assessment Method"]];
  if (Array.isArray(elos)) {
    elos.forEach(elo => {
      ws2Data.push([
        elo.code || '',
        elo.outcome || elo.description || '',
        elo.assessment || elo.assessmentMethod || ''
      ]);
    });
  }
  const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
  ws2['!cols'] = [{ wch: 15 }, { wch: 60 }, { wch: 40 }];

  // 3. Sheet: PPST-COT
  const ppst = data.ppstCot || data.ppst || data.matrix || [];
  const ws3Data = [["Exact Indicator", "Lesson Component", "Observable Evidence", "Alignment Status"]];
  if (Array.isArray(ppst)) {
    ppst.forEach(row => {
      ws3Data.push([
        row.indicator || '',
        row.lessonComponent || row.component || '',
        row.evidence || row.observableEvidence || '',
        row.status || 'Aligned'
      ]);
    });
  }
  const ws3 = XLSX.utils.aoa_to_sheet(ws3Data);
  ws3['!cols'] = [{ wch: 40 }, { wch: 30 }, { wch: 50 }, { wch: 15 }];

  // Create Workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "ILAW Lesson Plan");
  XLSX.utils.book_append_sheet(wb, ws2, "Expected Learning Outcomes");
  XLSX.utils.book_append_sheet(wb, ws3, "PPST-COT Alignment");

  // Format filename
  const safeSubject = (meta.subject || 'Subject').replace(/[^a-z0-9]/gi, '_');
  const safeGrade = (meta.gradeLevel || 'Grade').replace(/[^a-z0-9]/gi, '_');
  const filename = `LessonPlan_${safeSubject}_${safeGrade}.xlsx`;

  // Download
  XLSX.writeFile(wb, filename);
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

  history.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.innerHTML = `
      <div class="recent-item-info">
        <h4>${item.meta.topic}</h4>
        <span>${item.meta.subject} • ${item.meta.gradeLevel} • ${new Date().toLocaleDateString()}</span>
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