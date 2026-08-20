export const REVIEW = "REVISAR" as const;

export type Reading = {
  id: string;
  source: string;
  date: string | typeof REVIEW;
  vehicle: string | typeof REVIEW;
  litres: number | typeof REVIEW;
};

export type OcrBox = { x0: number; y0: number; x1: number; y1: number };

export type OcrWord = {
  text: string;
  confidence: number;
  bbox?: OcrBox;
};

export type OcrInput = {
  text: string;
  confidence: number;
  words?: OcrWord[];
};

export type LoadAnchor = {
  vehicle: string;
  confidence: number;
  bbox: OcrBox;
};

export type CropRegion = { left: number; top: number; width: number; height: number };

const monthNumbers: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[|]/g, "I")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidDate(day: number, month: number, year: number) {
  if (year < 2020 || year > 2100 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const candidate = new Date(year, month - 1, day);
  return (
    candidate.getFullYear() === year &&
    candidate.getMonth() === month - 1 &&
    candidate.getDate() === day
  );
}

function formatDate(day: number, month: number, year: number) {
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

export function extractDate(text: string, confidence: number) {
  if (confidence < 58) return REVIEW;

  const normalized = normalizeText(text).toLowerCase();
  const numeric = normalized.match(
    /(?:^|\D)([0-3]?\d)[/.\-]([01]?\d)[/.\-](20\d{2}|\d{2})(?:\D|$)/,
  );

  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const rawYear = Number(numeric[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    if (isValidDate(day, month, year)) return formatDate(day, month, year);
  }

  const written = normalized.match(
    /(?:^|\D)([0-3]?\d)\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+(?:de\s+)?)?(20\d{2})(?:\D|$)/,
  );

  if (written) {
    const day = Number(written[1]);
    const month = monthNumbers[written[2]];
    const year = Number(written[3]);
    if (isValidDate(day, month, year)) return formatDate(day, month, year);
  }

  return REVIEW;
}

function formatPlate(raw: string) {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(clean)) {
    return `${clean.slice(0, 2)} ${clean.slice(2, 5)} ${clean.slice(5)}`;
  }
  if (/^[A-Z]{3}\d{3}$/.test(clean)) {
    return `${clean.slice(0, 3)} ${clean.slice(3)}`;
  }
  return clean;
}

export function extractVehicle(text: string, confidence: number) {
  if (confidence < 62) return REVIEW;

  const normalized = normalizeText(text).toUpperCase();
  const modernPlate = normalized.match(/(?:^|\W)([A-Z]{2}\s?\d{3}\s?[A-Z]{2})(?:\W|$)/);
  if (modernPlate) return formatPlate(modernPlate[1]);

  const oldPlate = normalized.match(/(?:^|\W)([A-Z]{3}\s?\d{3})(?:\W|$)/);
  if (oldPlate) return formatPlate(oldPlate[1]);

  const identifier = normalized.match(
    /(?:TRACTOR|CAMION|CAMIONETA|TOLVA|MIXER|PULVERIZADORA|COSECHADORA|SEMBRADORA|UNIDAD|VEHICULO|MOVIL)\s*(?:N[°ºO.]?\s*)?([A-Z0-9][A-Z0-9 .\-]{0,18})/,
  );

  if (identifier) {
    const value = identifier[0]
      .replace(/\b(?:A?M|P?M)\b.*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (value.length >= 4) return value;
  }

  return REVIEW;
}

function mergeBoxes(words: OcrWord[]): OcrBox {
  const boxes = words.flatMap((word) => (word.bbox ? [word.bbox] : []));
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  };
}

function groupWordsIntoLines(words: OcrWord[]) {
  const positioned = words
    .filter((word): word is OcrWord & { bbox: OcrBox } => Boolean(word.bbox))
    .sort((a, b) => (a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2);
  const lines: Array<{ center: number; height: number; words: OcrWord[] }> = [];

  positioned.forEach((word) => {
    const center = (word.bbox.y0 + word.bbox.y1) / 2;
    const height = word.bbox.y1 - word.bbox.y0;
    const line = lines.find(
      (candidate) =>
        Math.abs(candidate.center - center) <=
        Math.max(10, height * 0.65, candidate.height * 0.65),
    );

    if (line) {
      line.words.push(word);
      line.center =
        line.words.reduce(
          (total, item) => total + ((item.bbox!.y0 + item.bbox!.y1) / 2),
          0,
        ) / line.words.length;
      line.height = Math.max(line.height, height);
    } else {
      lines.push({ center, height, words: [word] });
    }
  });

  return lines
    .map((line) => ({
      words: line.words.sort((a, b) => a.bbox!.x0 - b.bbox!.x0),
      center: line.center,
    }))
    .sort((a, b) => a.center - b.center);
}

export function findVehicleAnchors(words: OcrWord[]): LoadAnchor[] {
  const anchors = groupWordsIntoLines(words).flatMap((line) => {
    const text = line.words.map((word) => word.text).join(" ");
    const vehicle = extractVehicle(text, 100);
    if (vehicle === REVIEW) return [];

    const compactVehicle = vehicle.replace(/[^A-Z0-9]/g, "");
    const supportingWords = line.words.filter((word, index) =>
      [1, 2, 3].some((length) => {
        const compactWindow = line.words
          .slice(index, index + length)
          .map((item) => item.text.toUpperCase().replace(/[^A-Z0-9]/g, ""))
          .join("");
        return compactWindow === compactVehicle;
      }),
    );
    const evidence = supportingWords.length ? supportingWords : line.words;
    const confidence = Math.min(...evidence.map((word) => word.confidence));
    if (confidence < 62) return [];

    return [{ vehicle, confidence, bbox: mergeBoxes(evidence) }];
  });

  return anchors.filter(
    (anchor, index) =>
      !anchors.some(
        (other, otherIndex) =>
          otherIndex < index &&
          other.vehicle === anchor.vehicle &&
          Math.abs(other.bbox.y0 - anchor.bbox.y0) < 24,
      ),
  );
}

export function buildLoadRegions(
  anchors: LoadAnchor[],
  imageWidth: number,
  imageHeight: number,
): CropRegion[] {
  return anchors.map((anchor, index) => {
    const onLeftSide = (anchor.bbox.x0 + anchor.bbox.x1) / 2 < imageWidth / 2;
    const left = onLeftSide ? 0 : Math.floor(imageWidth * 0.55);
    const right = onLeftSide ? Math.ceil(imageWidth * 0.45) : imageWidth;
    const top = index === 0 ? 0 : Math.min(imageHeight, anchors[index - 1].bbox.y1 + 8);
    const bottom = Math.min(imageHeight, anchor.bbox.y1 + 20);

    return {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  });
}

export function extractDateFromOcr(input: OcrInput) {
  const wordDate = (input.words ?? [])
    .filter((word) => word.confidence >= 58)
    .sort((a, b) => (a.bbox?.y0 ?? 0) - (b.bbox?.y0 ?? 0))
    .map((word) => extractDate(word.text, word.confidence))
    .find((date) => date !== REVIEW);

  return wordDate ?? extractDate(input.text, input.confidence);
}

function parseLitresValue(raw: string) {
  const compact = raw.replace(/\s/g, "");
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0 || value > 5000) return null;
  return Math.round(value * 100) / 100;
}

export function extractLitres(input: OcrInput, imageHeight?: number) {
  const normalized = input.text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[|]/g, "I")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();
  const labelled = normalized.match(
    /(?:^|\D)(\d{1,4}(?:[.,]\d{1,2})?)[ \t]*(?:L|LT|LTS|LITRO|LITROS)\b/i,
  );
  if (labelled && input.confidence >= 55) {
    return parseLitresValue(labelled[1]) ?? REVIEW;
  }

  const words = input.words ?? [];
  const litreLabels = words.filter((word) =>
    /^(?:L|LT|LTS|LITRO|LITROS)[.,:]?$/i.test(word.text.trim()),
  );
  const candidates = words
    .map((word) => {
      const raw = word.text.trim();
      const meterLike = /^\d{0,3}[OoUu]\d{0,3}$/.test(raw) || /^\d{1,4}(?:[.,]\d{1,2})?$/.test(raw);
      const cleaned = raw.replace(/[OoUu]/g, "0").replace(/[^0-9.,]/g, "");
      const value = meterLike && /^\d{1,4}(?:[.,]\d{1,2})?$/.test(cleaned)
        ? parseLitresValue(cleaned)
        : null;
      const height = word.bbox ? word.bbox.y1 - word.bbox.y0 : 0;
      const relativeHeight = imageHeight && height ? height / imageHeight : 0;
      const hasLabelBelow = Boolean(
        imageHeight &&
          word.bbox &&
          litreLabels.some((label) => {
            if (!label.bbox) return false;
            const wordCenter = (word.bbox!.x0 + word.bbox!.x1) / 2;
            const labelCenter = (label.bbox.x0 + label.bbox.x1) / 2;
            const verticalGap = label.bbox.y0 - word.bbox!.y1;
            return (
              verticalGap >= 0 &&
              verticalGap <= imageHeight * 0.25 &&
              Math.abs(wordCenter - labelCenter) <= imageHeight * 0.2
            );
          }),
      );
      const looksLikeYear = value !== null && value >= 2020 && value <= 2100;
      return {
        value,
        confidence: word.confidence,
        relativeHeight,
        hasLabelBelow,
        meterLike,
        looksLikeYear,
      };
    })
    .filter(
      (candidate) =>
        candidate.value !== null &&
        (candidate.confidence >= 78 ||
          (candidate.confidence >= 65 &&
            candidate.meterLike &&
            candidate.relativeHeight >= 0.05) ||
          (candidate.confidence >= 60 &&
            candidate.meterLike &&
            candidate.relativeHeight >= 0.05 &&
            candidate.hasLabelBelow)) &&
        (candidate.relativeHeight >= 0.04 || candidate.hasLabelBelow) &&
        !candidate.looksLikeYear,
    )
    .sort(
      (a, b) =>
        b.relativeHeight * 100 + b.confidence / 100 -
        (a.relativeHeight * 100 + a.confidence / 100),
    );

  if (!candidates.length) return REVIEW;

  const best = candidates[0];
  const second = candidates[1];
  if (
    second &&
    Math.abs(best.relativeHeight - second.relativeHeight) < 0.004 &&
    Math.abs(best.confidence - second.confidence) < 5
  ) {
    return REVIEW;
  }

  return best.value ?? REVIEW;
}

export function parseOcrResult(
  input: OcrInput,
  source: string,
  imageHeight?: number,
): Reading {
  return {
    id: `${source}-${crypto.randomUUID()}`,
    source,
    date: extractDate(input.text, input.confidence),
    vehicle: extractVehicle(input.text, input.confidence),
    litres: extractLitres(input, imageHeight),
  };
}
