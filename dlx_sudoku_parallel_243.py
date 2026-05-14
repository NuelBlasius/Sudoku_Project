#!/usr/bin/env python3
"""
dlx_sudoku_parallel_243.py

Parallelized variant: compute candidate rows in parallel (per-chunk), then
assemble DLX structure and verify the provided filled puzzle by performing
cover() for each placement. This demonstrates a simple parallel step in the
pipeline; full parallel Algorithm X search is possible but much more complex
and requires careful state partitioning.

Usage:
  python dlx_sudoku_parallel_243.py

Outputs timing (candidate generation, DLX assembly, verification) in ms/sec.
"""

from PIL import Image, ImageDraw, ImageFont
import time
import argparse
import sys
import multiprocessing as mp


def generate_solution(N, br, bc):
    sol = [[0]*N for _ in range(N)]
    for r in range(N):
        for c in range(N):
            sol[r][c] = ((r * bc + (r // br) + c) % N) + 1
    return sol


def puzzle_from_solution(sol, remove_rate=0.0, seed=42):
    import random
    random.seed(seed)
    N = len(sol)
    puzzle = [row[:] for row in sol]
    if remove_rate <= 0:
        return puzzle
    total = N * N
    to_remove = int(total * remove_rate)
    indices = list(range(total))
    random.shuffle(indices)
    for idx in indices[:to_remove]:
        r = idx // N
        c = idx % N
        puzzle[r][c] = 0
    return puzzle


def rows_for_chunk(args):
    """Worker: compute rows for a slice of cell indices. Returns list of tuples.
    args = (start_idx, end_idx, N, br, bc, puzzle_flat)
    """
    start_idx, end_idx, N, br, bc, puzzle_flat = args
    rows = []
    numBoxesHoriz = N // bc
    for idx in range(start_idx, end_idx):
        r = idx // N
        c = idx % N
        b = (r // br) * numBoxesHoriz + (c // bc)
        vstart = puzzle_flat[idx] if puzzle_flat[idx] != 0 else 1
        vend = puzzle_flat[idx] if puzzle_flat[idx] != 0 else N
        for v in range(vstart, vend+1):
            col1 = r * N + c
            col2 = N * N + r * N + (v - 1)
            col3 = 2 * N * N + c * N + (v - 1)
            col4 = 3 * N * N + b * N + (v - 1)
            row_id = (r * N + c, v)
            rows.append((row_id, [col1, col2, col3, col4]))
    return rows


class DLXNode:
    __slots__ = ('L','R','U','D','C','row')
    def __init__(self):
        self.L = self.R = self.U = self.D = self
        self.C = None
        self.row = None


class ColumnNode(DLXNode):
    __slots__ = ('size','name')
    def __init__(self, name):
        super().__init__()
        self.size = 0
        self.name = name
        self.C = self


class DLX:
    def __init__(self, num_cols):
        self.header = ColumnNode('header')
        self.columns = [ColumnNode(i) for i in range(num_cols)]
        h = self.header
        h.L = self.columns[-1]
        h.R = self.columns[0]
        for i, col in enumerate(self.columns):
            col.L = self.columns[i-1] if i-1 >= 0 else h
            col.R = self.columns[i+1] if i+1 < len(self.columns) else h
            col.U = col.D = col
        h.L.R = h
        h.R.L = h
        self.row_node = {}

    def add_row(self, row_id, cols):
        nodes = []
        for c in cols:
            col = self.columns[c]
            node = DLXNode()
            node.C = col
            node.row = row_id
            node.U = col.U
            node.D = col
            col.U.D = node
            col.U = node
            col.size += 1
            nodes.append(node)
        for i in range(len(nodes)):
            nodes[i].R = nodes[(i+1) % len(nodes)]
            nodes[i].L = nodes[(i-1) % len(nodes)]
        if nodes:
            self.row_node[row_id] = nodes[0]

    def cover(self, col):
        col.R.L = col.L
        col.L.R = col.R
        i = col.D
        while i is not col:
            j = i.R
            while j is not i:
                j.D.U = j.U
                j.U.D = j.D
                j.C.size -= 1
                j = j.R
            i = i.D


def visualize_grid(grid, br, bc, cell_size=6, show_numbers=False, outpath='sudoku_243_parallel.png'):
    N = len(grid)
    border = 0
    img_w = N * cell_size + border * 2
    img_h = N * cell_size + border * 2
    img = Image.new('RGB', (img_w, img_h), (0, 0, 0))
    draw = ImageDraw.Draw(img)

    thin = 1
    thick = 3
    color_thin = (51,51,51)
    color_thick = (153,153,153)
    for x in range(N+1):
        x0 = border + x * cell_size
        w = thick if (x % bc == 0) else thin
        col = color_thick if (x % bc == 0) else color_thin
        draw.rectangle([x0, 0, x0 + w - 1, img_h], fill=col)
    for y in range(N+1):
        y0 = border + y * cell_size
        w = thick if (y % br == 0) else thin
        col = color_thick if (y % br == 0) else color_thin
        draw.rectangle([0, y0, img_w, y0 + w - 1], fill=col)

    if show_numbers:
        try:
            font = ImageFont.truetype('arial.ttf', max(8, int(cell_size*0.8)))
        except Exception:
            from PIL import ImageFont
            font = ImageFont.load_default()
        fg = (220,220,220)
        for r in range(N):
            for c in range(N):
                v = grid[r][c]
                if v:
                    txt = str(v)
                    x = c * cell_size + 2
                    y = r * cell_size + 1
                    draw.text((x,y), txt, fill=fg, font=font)
    img.save(outpath)
    return outpath


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--N', type=int, default=243)
    parser.add_argument('--br', type=int, default=9)
    parser.add_argument('--bc', type=int, default=27)
    parser.add_argument('--remove-rate', type=float, default=0.0)
    parser.add_argument('--cell-size', type=int, default=6)
    parser.add_argument('--show-numbers', action='store_true')
    parser.add_argument('--out', default='sudoku_243_parallel.png')
    args = parser.parse_args()

    N = args.N
    br = args.br
    bc = args.bc
    if br * bc != N:
        print('Error: br*bc must equal N')
        sys.exit(1)

    print('Generating solution...')
    t0 = time.perf_counter()
    sol = generate_solution(N, br, bc)
    t1 = time.perf_counter()
    print(f'Generated in {(t1-t0)*1000.0:.1f} ms')

    puzzle = puzzle_from_solution(sol, remove_rate=args.remove_rate)
    puzzle_flat = [puzzle[r][c] for r in range(N) for c in range(N)]

    # parallel candidate generation
    cpu = max(1, mp.cpu_count() - 0)
    chunk_size = math.ceil((N*N) / cpu)
    tasks = []
    for i in range(cpu):
        s = i * chunk_size
        e = min((i+1)*chunk_size, N*N)
        if s >= e: break
        tasks.append((s, e, N, br, bc, puzzle_flat))

    print(f'Computing {len(tasks)} chunks in parallel (cpu={cpu})...')
    t_start_rows = time.perf_counter()
    with mp.Pool(len(tasks)) as pool:
        results = pool.map(rows_for_chunk, tasks)
    t_end_rows = time.perf_counter()

    # flatten results
    rows = [r for chunk in results for r in chunk]
    total_candidates = len(rows)
    print(f'Candidate rows computed: {total_candidates} in {(t_end_rows-t_start_rows)*1000.0:.1f} ms')

    # Build DLX
    num_cols = 4 * N * N
    print('Assembling DLX nodes (main process)...')
    t0build = time.perf_counter()
    dlx = DLX(num_cols)
    for row_id, cols in rows:
        dlx.add_row(row_id, cols)
    t1build = time.perf_counter()
    print(f'DLX assembled in {(t1build-t0build)*1000.0:.1f} ms')

    # verify by covering each placement row (expect puzzle to be fully filled)
    print('Verifying by cover operations...')
    t0v = time.perf_counter()
    for r in range(N):
        for c in range(N):
            v = puzzle[r][c]
            if v == 0:
                raise ValueError('Parallel verifier expects fully-filled puzzle')
            row_id = (r * N + c, v)
            node = dlx.row_node.get(row_id)
            if node is None:
                raise ValueError(f'Row {row_id} missing in DLX')
            j = node
            while True:
                dlx.cover(j.C)
                j = j.R
                if j is node:
                    break
    t1v = time.perf_counter()
    print(f'Verify done in {(t1v-t0v)*1000.0:.1f} ms')

    solved = (dlx.header.R is dlx.header)
    print('Solution valid according to DLX:', solved)

    print('Rendering image...')
    out = visualize_grid(puzzle, br, bc, cell_size=args.cell_size, show_numbers=args.show_numbers, outpath=args.out)
    print('Saved to', out)


if __name__ == '__main__':
    import math
    main()
