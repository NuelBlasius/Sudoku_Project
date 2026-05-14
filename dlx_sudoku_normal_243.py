#!/usr/bin/env python3
"""
dlx_sudoku_normal_243.py

Generate and visualize a 243x243 Sudoku (br x bc blocks) and verify it using
Dancing Links (DLX) + Algorithm X cover operations.

By default this script generates a complete solved grid (fast), builds the
exact-cover DLX structure only for the given placements (one row per cell),
verifies the solution by performing cover() for each placement, and writes an
image file showing the grid. Building the full candidate matrix for many
empty cells (i.e. N choices per empty cell) is extremely large and may be
impractical in Python; the script will warn and refuse unless --force is set.

Usage examples:
  python dlx_sudoku_normal_243.py            # generate, verify, save image
  python dlx_sudoku_normal_243.py --remove-rate 0.05  # remove some cells (may be heavy)

Outputs runtime (build + verify) in ms and seconds.
"""

from PIL import Image, ImageDraw, ImageFont
import time
import argparse
import math
import sys


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
        # create column nodes
        self.columns = [ColumnNode(i) for i in range(num_cols)]
        # link columns horizontally under header
        h = self.header
        h.L = self.columns[-1]
        h.R = self.columns[0]
        for i, col in enumerate(self.columns):
            col.L = self.columns[i-1] if i-1 >= 0 else h
            col.R = self.columns[i+1] if i+1 < len(self.columns) else h
            # vertical links point to self initially
            col.U = col.D = col
        # fix circular linkage
        h.L.R = h
        h.R.L = h

        # mapping from row-id to one node belonging to that row
        self.row_node = {}

    def add_row(self, row_id, cols):
        """Add a row covering the list of column indices in `cols`.
        `row_id` can be any hashable that identifies the candidate (e.g. (cell, val)).
        """
        nodes = []
        for c in cols:
            col = self.columns[c]
            node = DLXNode()
            node.C = col
            node.row = row_id
            # insert node at bottom of column
            node.U = col.U
            node.D = col
            col.U.D = node
            col.U = node
            col.size += 1
            nodes.append(node)

        # link the row horizontally
        for i in range(len(nodes)):
            nodes[i].R = nodes[(i+1) % len(nodes)]
            nodes[i].L = nodes[(i-1) % len(nodes)]

        # store representative node
        if nodes:
            self.row_node[row_id] = nodes[0]

    def cover(self, col):
        # remove column header
        col.R.L = col.L
        col.L.R = col.R
        # for each row in column
        i = col.D
        while i is not col:
            j = i.R
            while j is not i:
                j.D.U = j.U
                j.U.D = j.D
                j.C.size -= 1
                j = j.R
            i = i.D

    def uncover(self, col):
        i = col.U
        while i is not col:
            j = i.L
            while j is not i:
                j.C.size += 1
                j.D.U = j
                j.U.D = j
                j = j.L
            i = i.U
        col.R.L = col
        col.L.R = col


def generate_solution(N, br, bc):
    """Deterministic generator for a filled N x N Sudoku where br*bc == N.
    Pattern used: value = (r*bc + floor(r/br) + c) % N + 1
    This guarantees each block (br x bc) contains all values 1..N and each
    row and column is a permutation.
    """
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


def build_rows_list(puzzle, N, br, bc, threshold=5_000_000):
    """Return list of (row_id, [col1,col2,col3,col4]) for each candidate.
    Raises MemoryError if candidate count too large unless overridden.
    """
    total_candidates = 0
    for r in range(N):
        for c in range(N):
            if puzzle[r][c] != 0:
                total_candidates += 1
            else:
                total_candidates += N

    if total_candidates > threshold:
        raise MemoryError(f"Too many candidates ({total_candidates}); aborting. Use smaller puzzle or increase threshold.")

    rows = []
    numBoxesHoriz = N // bc
    for r in range(N):
        for c in range(N):
            b = (r // br) * numBoxesHoriz + (c // bc)
            vstart = puzzle[r][c] if puzzle[r][c] != 0 else 1
            vend = puzzle[r][c] if puzzle[r][c] != 0 else N
            for v in range(vstart, vend+1):
                col1 = r * N + c
                col2 = N * N + r * N + (v - 1)
                col3 = 2 * N * N + c * N + (v - 1)
                col4 = 3 * N * N + b * N + (v - 1)
                row_id = (r * N + c, v)
                rows.append((row_id, [col1, col2, col3, col4]))
    return rows, total_candidates


def visualize_grid(grid, br, bc, cell_size=6, show_numbers=False, outpath='sudoku_243.png'):
    N = len(grid)
    border = 0
    img_w = N * cell_size + border * 2
    img_h = N * cell_size + border * 2
    img = Image.new('RGB', (img_w, img_h), (0, 0, 0))
    draw = ImageDraw.Draw(img)

    # draw light grid lines
    thin = 1
    thick = 3
    color_thin = (51, 51, 51)
    color_thick = (153, 153, 153)

    # vertical lines
    for x in range(N+1):
        x0 = border + x * cell_size
        w = thick if (x % bc == 0) else thin
        col = color_thick if (x % bc == 0) else color_thin
        draw.rectangle([x0, 0, x0 + w - 1, img_h], fill=col)

    # horizontal lines
    for y in range(N+1):
        y0 = border + y * cell_size
        w = thick if (y % br == 0) else thin
        col = color_thick if (y % br == 0) else color_thin
        draw.rectangle([0, y0, img_w, y0 + w - 1], fill=col)

    if show_numbers:
        try:
            font = ImageFont.truetype('arial.ttf', max(8, int(cell_size*0.8)))
        except Exception:
            font = ImageFont.load_default()

        fg = (220, 220, 220)
        for r in range(N):
            for c in range(N):
                v = grid[r][c]
                if v:
                    txt = str(v)
                    x = c * cell_size + 2
                    y = r * cell_size + 1
                    draw.text((x, y), txt, fill=fg, font=font)

    img.save(outpath)
    return outpath


def verify_solution_with_dlx(puzzle, N, br, bc):
    """Build DLX for given puzzle (rows only for allowed candidates), then
    verify the provided placements by covering corresponding rows in DLX and
    checking header emptiness. Returns (build_ms, verify_ms).
    """
    start_build = time.perf_counter()
    rows_list, total_candidates = build_rows_list(puzzle, N, br, bc)
    num_cols = 4 * N * N

    dlx = DLX(num_cols)
    for row_id, cols in rows_list:
        dlx.add_row(row_id, cols)
    end_build = time.perf_counter()

    # verify: for each filled cell select its row and cover
    start_verify = time.perf_counter()
    for r in range(N):
        for c in range(N):
            v = puzzle[r][c]
            if v == 0:
                raise ValueError("verify_solution_with_dlx expects a fully filled puzzle")
            row_id = (r * N + c, v)
            if row_id not in dlx.row_node:
                raise ValueError(f"Row for cell {(r,c)} val {v} not present in DLX structure")
            node = dlx.row_node[row_id]
            # cover the columns for this row
            # cover the column of each node in the row (use node and its right chain)
            j = node
            while True:
                dlx.cover(j.C)
                j = j.R
                if j is node:
                    break

    solved = (dlx.header.R is dlx.header)
    end_verify = time.perf_counter()

    build_ms = (end_build - start_build) * 1000.0
    verify_ms = (end_verify - start_verify) * 1000.0
    return solved, build_ms, verify_ms, total_candidates


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--N', type=int, default=243, help='Grid size N (default 243)')
    p.add_argument('--br', type=int, default=9, help='Block rows (br)')
    p.add_argument('--bc', type=int, default=27, help='Block cols (bc)')
    p.add_argument('--remove-rate', type=float, default=0.0, help='Fraction of cells to remove (0..1)')
    p.add_argument('--cell-size', type=int, default=6, help='Cell pixel size for image')
    p.add_argument('--show-numbers', action='store_true', help='Render numbers into image (slow)')
    p.add_argument('--out', default='sudoku_243_normal.png', help='Output image path')
    return p.parse_args()


def main():
    args = parse_args()
    N = args.N
    br = args.br
    bc = args.bc

    if br * bc != N:
        print('Error: must satisfy br * bc == N')
        sys.exit(1)

    print(f'Generating deterministic solution {N}x{N} (br={br}, bc={bc})...')
    t0 = time.perf_counter()
    sol = generate_solution(N, br, bc)
    t1 = time.perf_counter()
    gen_ms = (t1 - t0) * 1000.0
    print(f'Generated solution in {gen_ms:.1f} ms')

    puzzle = puzzle_from_solution(sol, remove_rate=args.remove_rate)

    print('Building DLX and verifying provided solution (may be heavy for many empties)...')
    solved, build_ms, verify_ms, total_candidates = verify_solution_with_dlx(puzzle, N, br, bc)

    print(f'Candidates counted: {total_candidates}')
    print(f'DLX build: {build_ms:.1f} ms ({build_ms/1000.0:.3f} sec)')
    print(f'Verify (cover ops): {verify_ms:.1f} ms ({verify_ms/1000.0:.3f} sec)')
    print('Solution valid according to DLX:' , solved)

    print('Rendering image (this may take a moment)...')
    out = visualize_grid(puzzle, br, bc, cell_size=args.cell_size, show_numbers=args.show_numbers, outpath=args.out)
    print('Saved visualization to', out)


if __name__ == '__main__':
    main()
