import { Chess, Color, PieceSymbol, Square } from "chess.js";

const files = ["a", "b", "c", "d", "e", "f", "g", "h"];

export function parseUciMove(raw: string):
  | { from: Square; to: Square; promotion?: PieceSymbol }
  | null {
  // More flexible cleaning - handle various formats
  const cleaned = raw.trim().toLowerCase()
    .replace(/[^a-z0-9]/g, "") // Remove all non-alphanumeric
    .replace(/^move:?/i, "") // Remove "move:" prefix if present
    .trim();

  if (cleaned === "resign" || cleaned === "") return null;
  if (cleaned.length < 4 || cleaned.length > 5) {
    console.log(`[parseUciMove] Invalid length: "${cleaned}" (${cleaned.length} chars)`);
    return null;
  }

  const from = cleaned.slice(0, 2) as Square;
  const to = cleaned.slice(2, 4) as Square;

  if (!isSquare(from) || !isSquare(to)) {
    console.log(`[parseUciMove] Invalid squares: from="${from}" to="${to}"`);
    return null;
  }

  const promotion = cleaned[4] as PieceSymbol | undefined;
  if (promotion && !"qrbn".includes(promotion)) {
    return { from, to };
  }

  return { from, to, promotion };
}

export function isSquare(value: string): value is Square {
  return /^[a-h][1-8]$/.test(value);
}

export function activeColorFromFen(fen: string): Color {
  const parts = fen.split(" ");
  return (parts[1] as Color) ?? "w";
}

function squareToIndex(square: Square) {
  const file = files.indexOf(square[0]);
  const rank = 8 - parseInt(square[1], 10);
  return { rank, file };
}

function boardToFen(board: ReturnType<Chess["board"]>) {
  return board
    .map((rank) => {
      let empty = 0;
      let row = "";
      for (const square of rank) {
        if (!square) {
          empty += 1;
          continue;
        }
        if (empty) {
          row += empty;
          empty = 0;
        }
        const symbol = square.type === "p" ? "p" : square.type;
        row += square.color === "w" ? symbol.toUpperCase() : symbol.toLowerCase();
      }
      if (empty) row += empty;
      return row;
    })
    .join("/");
}

export function applyChaosMove(
  fen: string,
  uci: { from: Square; to: Square; promotion?: PieceSymbol },
  color: Color,
  fullmoveNumber: number
) {
  const base = new Chess(fen);
  const board = base.board();
  const { rank: fromRank, file: fromFile } = squareToIndex(uci.from);
  const { rank: toRank, file: toFile } = squareToIndex(uci.to);

  const promotion = uci.promotion;
  const existing = board[fromRank][fromFile];
  const piece = existing ?? { type: promotion ?? "p", color };

  board[fromRank][fromFile] = null;
  board[toRank][toFile] = { type: promotion ?? piece.type, color, square: uci.to };

  const placement = boardToFen(board);
  const nextTurn: Color = color === "w" ? "b" : "w";
  const nextFullmove = color === "b" ? fullmoveNumber + 1 : fullmoveNumber;

  const nextFen = `${placement} ${nextTurn} - - 0 ${nextFullmove}`;
  return { fen: nextFen, san: `${uci.from}${uci.to}${promotion ?? ""}` };
}
