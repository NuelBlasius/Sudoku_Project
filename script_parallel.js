/* script_parallel_optimized.js */
let puzzle = [];
let cells = [];
let timerInterval = null;
let worker = null;

// Optional step delay available to pages via `window.STEP_DELAY`
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

  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  cells = [];
  grid.style.gridTemplateColumns = `repeat(${N}, 32px)`;

  // Gunakan DocumentFragment untuk batch DOM insertion
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < N * N; i++) {
    let d = document.createElement("div");
    d.className = "cell";
    if (puzzle[i] !== 0) {
      d.textContent = puzzle[i];
      d.classList.add("given");
    }
    fragment.appendChild(d);
    cells.push(d);
  }
  grid.appendChild(fragment);
}

function startParallel() {
  if (worker) return; 

  if (!cells || cells.length !== N * N) {
    try { initGrid(); } catch (err) { console.error('initGrid error in startParallel', err); }
  }
  
  // Reset grid quickly
  cells.forEach((c, i) => {
    c.classList.remove('solve', 'given');
    if (puzzle[i]) {
      c.textContent = puzzle[i];
      c.classList.add('given');
    } else {
      c.textContent = "";
    }
  });

  let timerEl = document.getElementById("timer");
  let startTime = performance.now();

  timerInterval = setInterval(() => {
    let diff = performance.now() - startTime;
    timerEl.textContent = Math.round(diff) + " ms (" + (diff / 1000).toFixed(2) + " sec)";
  }, 100); // Update timer lebih jarang (100ms)

  // ==========================================
  // OPTIMIZED DLX + ALGORITHM X IN WORKER
  // ==========================================
  let workerCode = `
  self.onmessage = function(e) {
    let { board, N, boxR, boxC, stepDelay } = e.data;
    let originalBoard = board.slice();
    
    // OPTIMASI PARALLEL 1: Langsung eksekusi tanpa delay
    // Gunakan setTimeout(0) hanya untuk inisialisasi worker message handling
    setTimeout(() => {
      try {
        solveSudoku(board, N, boxR, boxC, originalBoard, stepDelay);
      } catch (error) {
        self.postMessage({ 
          type: "error", 
          error: error.message,
          stack: error.stack 
        });
      }
    }, 0);
  };

  function solveSudoku(board, N, boxR, boxC, originalBoard, stepDelay) {
    // OPTIMASI PARALLEL 2: Class Node dengan properti pre-initialized
    class Node {
      constructor() {
        this.L = this;
        this.R = this;
        this.U = this;
        this.D = this;
        this.C = null;
        this.rowInfo = null;
      }
    }

    let header = new Node();
    let columns = [];
    let numCols = 4 * N * N;
    
    // OPTIMASI PARALLEL 3: Pre-allocate columns array
    columns = new Array(numCols);

    // Inisiasi Column Headers
    for (let j = 0; j < numCols; j++) {
      let colNode = new Node();
      colNode.size = 0;
      colNode.C = colNode;
      colNode.L = header.L;
      colNode.R = header;
      header.L.R = colNode;
      header.L = colNode;
      columns[j] = colNode;
    }

    // OPTIMASI PARALLEL 4: Pre-calculate box indices
    let numBoxesHorizontally = N / boxC;
    let boxLookup = new Array(N * N);
    for (let i = 0; i < N * N; i++) {
      let r = Math.floor(i / N);
      let c = i % N;
      boxLookup[i] = Math.floor(r / boxR) * numBoxesHorizontally + Math.floor(c / boxC);
    }

    // OPTIMASI PARALLEL 5: Pre-calculate constraint indices
    let constraintCache = new Array(N * N * N);
    
    // Membangun matriks Exact Cover
    for (let i = 0; i < N * N; i++) {
      let r = Math.floor(i / N);
      let c = i % N;
      let b = boxLookup[i];

      let startV = board[i] !== 0 ? board[i] : 1;
      let endV = board[i] !== 0 ? board[i] : N;

      for (let v = startV; v <= endV; v++) {
        let col1 = i;
        let col2 = N * N + r * N + (v - 1);
        let col3 = 2 * N * N + c * N + (v - 1);
        let col4 = 3 * N * N + b * N + (v - 1);

        let cols = [col1, col2, col3, col4];
        let rowNodes = [];

        for (let k = 0; k < 4; k++) {
          let node = new Node();
          let colNode = columns[cols[k]];
          node.C = colNode;
          node.rowInfo = { i: i, v: v };

          node.U = colNode.U;
          node.D = colNode;
          colNode.U.D = node;
          colNode.U = node;
          colNode.size++;

          rowNodes.push(node);
        }

        // Link horizontal
        for (let k = 0; k < 4; k++) {
          rowNodes[k].R = rowNodes[(k + 1) % 4];
          rowNodes[k].L = rowNodes[(k + 3) % 4];
        }
      }
    }

    // OPTIMASI PARALLEL 6: While loops (lebih cepat dari for)
    function cover(cNode) {
      cNode.R.L = cNode.L;
      cNode.L.R = cNode.R;
      
      let i = cNode.D;
      while (i !== cNode) {
        let j = i.R;
        while (j !== i) {
          j.D.U = j.U;
          j.U.D = j.D;
          j.C.size--;
          j = j.R;
        }
        i = i.D;
      }
    }

    function uncover(cNode) {
      let i = cNode.U;
      while (i !== cNode) {
        let j = i.L;
        while (j !== i) {
          j.C.size++;
          j.D.U = j;
          j.U.D = j;
          j = j.L;
        }
        i = i.U;
      }
      
      cNode.R.L = cNode;
      cNode.L.R = cNode;
    }

    // OPTIMASI PARALLEL 7: Buffer updates untuk batch processing
    let updateBuffer = [];
    let stepsCounter = 0;
    const BUFFER_SIZE = stepDelay > 0 ? 10 : 1000;
    
    function flushUpdates() {
      if (updateBuffer.length > 0) {
        self.postMessage({ 
          type: "batch_update", 
          updates: updateBuffer 
        }, undefined); // OPTIMASI PARALLEL 8: Tidak transfer array buffer
        updateBuffer = [];
      }
    }

    // OPTIMASI PARALLEL 9: Algorithm X dengan minim postMessage
    function search(k) {
      if (header.R === header) {
        // SOLVED! Kirim hasil final via batch
        flushUpdates();
        return true;
      }

      // Pilih kolom dengan size terkecil
      let c = header.R;
      let minSize = c.size;
      
      // Early exit untuk impossible branch
      if (minSize === 0) return false;
      
      let j = c.R;
      while (j !== header) {
        if (j.size < minSize) {
          minSize = j.size;
          c = j;
          if (minSize === 0) return false;
        }
        j = j.R;
      }

      cover(c);

      let r = c.D;
      while (r !== c) {
        let { i, v } = r.rowInfo;
        let wasEmpty = originalBoard[i] === 0;

        if (wasEmpty) {
          board[i] = v;
          
          // OPTIMASI PARALLEL 10: Buffer updates, jangan kirim setiap langkah
          if (stepDelay > 0) {
            updateBuffer.push({ i: i, v: v });
            stepsCounter++;
            
            // Flush buffer jika sudah mencapai batas
            if (updateBuffer.length >= BUFFER_SIZE) {
              flushUpdates();
            }
          }
          // Jika stepDelay = 0, tidak kirim update sama sekali!
        }

        // Cover remaining columns
        j = r.R;
        while (j !== r) {
          cover(j.C);
          j = j.R;
        }

        if (search(k + 1)) return true;

        // Uncover (reverse order)
        j = r.L;
        while (j !== r) {
          uncover(j.C);
          j = j.L;
        }

        if (wasEmpty) {
          board[i] = 0;
          
          if (stepDelay > 0) {
            updateBuffer.push({ i: i, v: "" });
          }
        }
        
        r = r.D;
      }

      uncover(c);
      return false;
    }

    // OPTIMASI PARALLEL 11: Eksekusi search SYNCHRONOUS (no async overhead!)
    let isSolved = search(0);
    
    // OPTIMASI PARALLEL 12: Kirim final board SEKALI
    if (isSolved) {
      // Board sudah terisi, kirim hasil final
      self.postMessage({ 
        type: "done", 
        finalBoard: board,
        solved: true
      });
    } else {
      self.postMessage({ 
        type: "done", 
        finalBoard: null,
        solved: false
      });
    }
  }
  `;

  // OPTIMASI PARALLEL 13: Buat worker dengan inline code
  let workerURL = URL.createObjectURL(new Blob([workerCode], { type: "application/javascript" }));
  worker = new Worker(workerURL);

  // OPTIMASI PARALLEL 14: Kirim data minimal ke worker
  worker.postMessage({ 
    board: puzzle.slice(), 
    N: N, 
    boxR: boxR, 
    boxC: boxC,
    stepDelay: STEP_DELAY 
  });

  // OPTIMASI PARALLEL 15: Message handler yang efisien
  worker.onmessage = function(e) {
    let d = e.data;

    // OPTIMASI PARALLEL 16: Batch update processing
    if (d.type === "batch_update") {
      // Gunakan requestAnimationFrame untuk smooth rendering
      requestAnimationFrame(() => {
        d.updates.forEach(update => {
          if (update.v !== "") {
            cells[update.i].classList.remove('given');
            cells[update.i].textContent = update.v;
            cells[update.i].classList.add('solve');
          } else {
            cells[update.i].classList.remove('solve');
            if (puzzle[update.i]) {
              cells[update.i].textContent = puzzle[update.i];
              cells[update.i].classList.add('given');
            } else {
              cells[update.i].textContent = "";
            }
          }
        });
      });
    }
    else if (d.type === "done") {
      clearInterval(timerInterval);
      let end = performance.now();
      let diff = end - startTime;
      timerEl.textContent = Math.round(diff) + " ms (" + (diff / 1000).toFixed(2) + " sec)";

      if (d.solved && d.finalBoard) {
        // OPTIMASI PARALLEL 17: Satu kali render final
        requestAnimationFrame(() => {
          for (let i = 0; i < N * N; i++) {
            cells[i].classList.remove('solve', 'given');
            if (puzzle[i] === 0) {
              cells[i].textContent = d.finalBoard[i] !== 0 ? d.finalBoard[i] : "";
              cells[i].classList.add('solve');
            } else {
              cells[i].textContent = puzzle[i];
              cells[i].classList.add('given');
            }
          }
        });
        
        console.log("✅ Sudoku solved successfully by Web Worker!");
      } else {
        console.warn("❌ No solution found by Web Worker");
      }

      // OPTIMASI PARALLEL 18: Cleanup worker & URL
      worker.terminate();
      worker = null;
      URL.revokeObjectURL(workerURL);
    }
    else if (d.type === "error") {
      clearInterval(timerInterval);
      console.error('Worker error:', d.error);
      worker.terminate();
      worker = null;
      URL.revokeObjectURL(workerURL);
    }
  };

  // OPTIMASI PARALLEL 19: Worker error handling
  worker.onerror = function(error) {
    clearInterval(timerInterval);
    console.error('Worker runtime error:', error);
    worker.terminate();
    worker = null;
    URL.revokeObjectURL(workerURL);
  };
}

function resetGrid() {
  if (worker) {
    worker.terminate(); 
    worker = null;
  }
  clearInterval(timerInterval);
  
  // OPTIMASI PARALLEL 20: Batch DOM update for reset
  requestAnimationFrame(() => {
    for (let i = 0; i < cells.length; i++) {
      cells[i].classList.remove('solve', 'given');
      cells[i].textContent = puzzle[i] ? puzzle[i] : "";
      if (puzzle[i]) cells[i].classList.add('given');
    }
  });
  
  document.getElementById("timer").textContent = "0 ms (0.00 sec)";
}

window.onload = initGrid;