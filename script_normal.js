/* script_normal.js */
let board = [];
let puzzle = [];
let cells = [];
let timerInterval = null;
let stopSignal = false;
let isSolving = false;

// Konfigurasi jeda langkah (ms). 0 berarti secepat mungkin.
const STEP_DELAY = (typeof window !== 'undefined' && typeof window.STEP_DELAY !== 'undefined') ? window.STEP_DELAY : 0;

// Fungsi Generate Puzzle Otomatis berbasis Seed
function generateSeededPuzzle(n, br, bc, seed) {
  let currentSeed = seed || 1;
  function rand() {
    let x = Math.sin(currentSeed++) * 10000;
    return x - Math.floor(x);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      let j = Math.floor(rand() * (i + 1));
      let tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  let full = new Array(n * n).fill(0);

  function isSafeBoard(b, r, c, v) {
    for (let i = 0; i < n; i++) {
      if (b[r * n + i] === v) return false;
      if (b[i * n + c] === v) return false;
    }
    let boxStartR = Math.floor(r / br) * br;
    let boxStartC = Math.floor(c / bc) * bc;
    for (let i = 0; i < br; i++) {
      for (let j = 0; j < bc; j++) {
        if (b[(boxStartR + i) * n + (boxStartC + j)] === v) return false;
      }
    }
    return true;
  }

  function fillBoard(i = 0) {
    if (i >= n * n) return true;
    let r = Math.floor(i / n);
    let c = i % n;
    if (full[i] !== 0) return fillBoard(i + 1);

    let vals = shuffle(Array.from({ length: n }, (_, k) => k + 1));
    for (let v of vals) {
      if (!isSafeBoard(full, r, c, v)) continue;
      full[i] = v;
      if (fillBoard(i + 1)) return true;
      full[i] = 0;
    }
    return false;
  }

  if (!fillBoard(0)) {
    console.warn('generateSeededPuzzle: failed to generate full solution');
    return new Array(n * n).fill(0);
  }

  let givens = Math.max(1, Math.floor(n * n * 0.3));
  let puzzle = full.slice();
  let indices = shuffle(Array.from({ length: n * n }, (_, k) => k));
  let toRemove = n * n - givens;
  for (let idx of indices) {
    if (toRemove <= 0) break;
    puzzle[idx] = 0;
    toRemove--;
  }

  return puzzle;
}

function initGrid() {
  let attempts = 0;
  do {
    puzzle = generateSeededPuzzle(N, boxR, boxC, SEED + attempts);
    attempts++;
  } while (puzzle.every(v => v === 0) && attempts < 10);
  board = puzzle.slice();

  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  cells = [];
  grid.style.gridTemplateColumns = `repeat(${N}, 32px)`;

  for (let i = 0; i < N * N; i++) {
    let d = document.createElement("div");
    d.className = "cell";
    if (board[i] !== 0) {
      d.textContent = board[i];
      d.classList.add("given");
    }
    grid.appendChild(d);
    cells.push(d);
  }
}

function sleep(ms) { 
  return new Promise(r => setTimeout(r, ms)); 
}

// ==========================================
// KELAS DAN FUNGSI DLX (MAIN THREAD)
// ==========================================
class Node {
  constructor() {
    this.L = this.R = this.U = this.D = this;
    this.C = null;
    this.rowInfo = null;
  }
}

let header, columns, dlxSteps;

function buildDLX() {
  header = new Node();
  columns = [];
  dlxSteps = 0;
  let numCols = 4 * N * N;

  for (let j = 0; j < numCols; j++) {
    let colNode = new Node();
    colNode.size = 0;
    colNode.C = colNode;
    colNode.L = header.L;
    colNode.R = header;
    header.L.R = colNode;
    header.L = colNode;
    columns.push(colNode);
  }

  function getBoxIdx(r, c) {
    let numBoxesHorizontally = N / boxC;
    return Math.floor(r / boxR) * numBoxesHorizontally + Math.floor(c / boxC);
  }

  for (let i = 0; i < N * N; i++) {
    let r = Math.floor(i / N);
    let c = i % N;
    let b = getBoxIdx(r, c);

    let startV = puzzle[i] !== 0 ? puzzle[i] : 1;
    let endV = puzzle[i] !== 0 ? puzzle[i] : N;

    for (let v = startV; v <= endV; v++) {
      let col1 = i;
      let col2 = N * N + r * N + (v - 1);
      let col3 = 2 * N * N + c * N + (v - 1);
      let col4 = 3 * N * N + b * N + (v - 1);

      let rowNodes = [];
      [col1, col2, col3, col4].forEach(colIdx => {
        let node = new Node();
        let colNode = columns[colIdx];
        node.C = colNode;
        node.rowInfo = { i: i, v: v };

        node.U = colNode.U;
        node.D = colNode;
        colNode.U.D = node;
        colNode.U = node;
        colNode.size++;

        rowNodes.push(node);
      });

      for (let k = 0; k < 4; k++) {
        rowNodes[k].R = rowNodes[(k + 1) % 4];
        rowNodes[k].L = rowNodes[(k + 3) % 4];
      }
    }
  }
}

function cover(cNode) {
  cNode.R.L = cNode.L;
  cNode.L.R = cNode.R;
  for (let i = cNode.D; i !== cNode; i = i.D) {
    for (let j = i.R; j !== i; j = j.R) {
      j.D.U = j.U;
      j.U.D = j.D;
      j.C.size--;
    }
  }
}

function uncover(cNode) {
  for (let i = cNode.U; i !== cNode; i = i.U) {
    for (let j = i.L; j !== i; j = j.L) {
      j.C.size++;
      j.D.U = j;
      j.U.D = j;
    }
  }
  cNode.R.L = cNode;
  cNode.L.R = cNode;
}

// Algoritma X berjalan di Main Thread
async function searchDLX(k) {
  if (stopSignal) return false;
  if (header.R === header) return true; // Solved!

  let c = header.R;
  for (let j = header.R; j !== header; j = j.R) {
    if (j.size < c.size) c = j;
  }

  cover(c);

  for (let r = c.D; r !== c; r = r.D) {
    let { i, v } = r.rowInfo;
    let wasEmpty = (puzzle[i] === 0);

    if (wasEmpty) {
      board[i] = v;
      cells[i].textContent = v;
      cells[i].classList.add("solve");

      if (STEP_DELAY > 0) {
        await sleep(STEP_DELAY);
      } else {
        dlxSteps++;
        // Mencegah UI/Browser Freeze karena berjalan di Main Thread
        // Jeda setiap beberapa langkah agar timer bisa terupdate
        if (dlxSteps % 50 === 0) await new Promise(res => setTimeout(res, 0));
      }
    }

    for (let j = r.R; j !== r; j = j.R) cover(j.C);

    if (await searchDLX(k + 1)) return true;

    if (stopSignal) return false;

    for (let j = r.L; j !== r; j = j.L) uncover(j.C);

    if (wasEmpty) {
      board[i] = 0;
      cells[i].textContent = "";
      cells[i].classList.remove("solve");
    }
  }

  uncover(c);
  return false;
}

// ==========================================
// KONTROL UI UTAMA
// ==========================================
async function startNormal() {
  if (isSolving) return;
  isSolving = true;
  stopSignal = false;
  
  let timerEl = document.getElementById("timer");
  let s = performance.now();

  // Reset Timer UI
  timerInterval = setInterval(() => {
    let now = performance.now();
    let diff = now - s;
    timerEl.textContent = Math.round(diff) + " ms (" + (diff / 1000).toFixed(2) + " sec)";
  }, 50);

  // Pastikan grid dan puzzle sudah siap
  if (!cells || cells.length !== N * N) {
    try { initGrid(); } catch (err) { console.error(err); }
  }
  
  cells.forEach((c, i) => {
    c.classList.remove('solve', 'given');
    if (puzzle[i]) {
      c.textContent = puzzle[i];
      c.classList.add('given');
    } else {
      c.textContent = "";
    }
  });

  board = puzzle.slice();
  
  // Persiapkan DLX Nodes
  buildDLX();

  // Mulai pencarian DLX di main thread
  let success = await searchDLX(0);

  if (!stopSignal) {
    clearInterval(timerInterval);
    let e = performance.now();
    let diff = e - s;
    timerEl.textContent = Math.round(diff) + " ms (" + (diff / 1000).toFixed(2) + " sec)";
    
    if (!success) {
      console.warn("No solution found!");
    }
  }

  isSolving = false;
}

function resetGrid() {
  stopSignal = true; 
  isSolving = false;
  clearInterval(timerInterval);
  
  board = puzzle.slice();
  cells.forEach((c, i) => {
    c.classList.remove('solve', 'given');
    c.textContent = board[i] ? board[i] : "";
    if (board[i]) c.classList.add('given');
  });
  
  document.getElementById("timer").textContent = "0 ms (0.00 sec)";
}

window.onload = initGrid;