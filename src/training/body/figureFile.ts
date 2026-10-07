// The baked figures (`npm run body-figures:bake`), parsed once on first use.
// Read as text so the typechecker never parses 175 KB of base64.

import figureFileText from "./bodyFigures.json?raw";
import type { BodyFigureFile } from "./bodyFigureMath";

let figureFile: BodyFigureFile | null = null;

export const readFigureFile = () => (figureFile ??= JSON.parse(figureFileText) as BodyFigureFile);
