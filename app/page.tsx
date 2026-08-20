"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { OEM, PSM, createWorker } from "tesseract.js";
import {
  CropRegion,
  OcrWord,
  REVIEW,
  Reading,
  buildLoadRegions,
  extractDateFromOcr,
  extractLitres,
  findVehicleAnchors,
  parseOcrResult,
} from "./ocr-parser";

type OcrBlock = {
  paragraphs?: Array<{
    lines?: Array<{
      words?: Array<{
        text?: string;
        confidence?: number;
        bbox?: { x0: number; y0: number; x1: number; y1: number };
      }>;
    }>;
  }>;
};

type OcrData = {
  text: string;
  confidence: number;
  blocks?: OcrBlock[] | null;
};

function collectWords(blocks?: OcrBlock[] | null): OcrWord[] {
  if (!blocks) return [];
  return blocks.flatMap((block) =>
    (block.paragraphs ?? []).flatMap((paragraph) =>
      (paragraph.lines ?? []).flatMap((line) =>
        (line.words ?? []).flatMap((word) =>
          word.text
            ? [{ text: word.text, confidence: word.confidence ?? 0, bbox: word.bbox }]
            : [],
        ),
      ),
    ),
  );
}

async function getImageSize(file: File) {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Imagen inválida"))), "image/png");
  });
}

async function preprocessRegion(file: File, region: CropRegion) {
  const bitmap = await createImageBitmap(file);
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = region.width * scale;
  canvas.height = region.height * scale;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error("No se pudo preparar la imagen");
  }

  context.drawImage(
    bitmap,
    region.left,
    region.top,
    region.width,
    region.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  bitmap.close();

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  let darkest = 255;
  let lightest = 0;
  for (let index = 0; index < pixels.data.length; index += 4) {
    const grey = Math.round(
      pixels.data[index] * 0.299 +
        pixels.data[index + 1] * 0.587 +
        pixels.data[index + 2] * 0.114,
    );
    darkest = Math.min(darkest, grey);
    lightest = Math.max(lightest, grey);
    pixels.data[index] = grey;
    pixels.data[index + 1] = grey;
    pixels.data[index + 2] = grey;
  }

  const range = Math.max(1, lightest - darkest);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const contrasted = Math.round(((pixels.data[index] - darkest) / range) * 255);
    pixels.data[index] = contrasted;
    pixels.data[index + 1] = contrasted;
    pixels.data[index + 2] = contrasted;
  }
  context.putImageData(pixels, 0, 0);

  return { blob: await canvasToBlob(canvas), height: canvas.height };
}

function formatLitres(value: number) {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: value % 1 ? 1 : 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function ReviewValue() {
  return <span className="review-badge">REVISAR</span>;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState("");

  const summary = useMemo(() => {
    const groups = new Map<string, { count: number; litres: number }>();
    readings.forEach((reading) => {
      const current = groups.get(reading.vehicle) ?? { count: 0, litres: 0 };
      current.count += 1;
      if (typeof reading.litres === "number") current.litres += reading.litres;
      groups.set(reading.vehicle, current);
    });
    return [...groups.entries()].map(([vehicle, values]) => ({ vehicle, ...values }));
  }, [readings]);

  const totalLitres = useMemo(
    () =>
      readings.reduce(
        (total, reading) => total + (typeof reading.litres === "number" ? reading.litres : 0),
        0,
      ),
    [readings],
  );

  function selectFiles(nextFiles: File[]) {
    const images = nextFiles.filter((file) => file.type.startsWith("image/"));
    setFiles(images);
    setReadings([]);
    setProgress(0);
    setStatus("idle");
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectFiles(Array.from(event.target.files ?? []));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    selectFiles(Array.from(event.dataTransfer.files));
  }

  async function analyse() {
    if (!files.length || status === "processing") return;
    setStatus("processing");
    setReadings([]);
    setProgress(1);

    const extracted: Reading[] = [];
    let fileIndex = 0;
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;

    try {
      worker = await createWorker("spa", OEM.LSTM_ONLY, {
        logger(message) {
          if (message.status === "recognizing text") {
            const fileProgress = Math.max(0, Math.min(1, message.progress ?? 0));
            setProgress(Math.round(((fileIndex + fileProgress) / files.length) * 100));
          }
        },
      });

      for (fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex];
        setCurrentFile(file.name);
        try {
          await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
          const [result, imageSize] = await Promise.all([
            worker.recognize(file, {}, { blocks: true, text: true }),
            getImageSize(file),
          ]);
          const data = result.data as unknown as OcrData;
          const input = {
            text: data.text,
            confidence: data.confidence,
            words: collectWords(data.blocks),
          };
          const anchors = findVehicleAnchors(input.words);

          if (!anchors.length) {
            extracted.push(
              parseOcrResult(
                input,
                file.name,
                imageSize.height,
              ),
            );
            continue;
          }

          const date = extractDateFromOcr(input);
          const regions = buildLoadRegions(
            anchors,
            imageSize.width,
            imageSize.height,
          );
          await worker.setParameters({
            preserve_interword_spaces: "1",
            tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          });

          for (let index = 0; index < anchors.length; index += 1) {
            let litres: number | typeof REVIEW = REVIEW;
            try {
              const prepared = await preprocessRegion(file, regions[index]);
              const cropResult = await worker.recognize(
                prepared.blob,
                {},
                { blocks: true, text: true },
              );
              const cropData = cropResult.data as unknown as OcrData;
              litres = extractLitres(
                {
                  text: cropData.text,
                  confidence: cropData.confidence,
                  words: collectWords(cropData.blocks),
                },
                prepared.height,
              );
            } catch {
              litres = REVIEW;
            }

            extracted.push({
              id: `${file.name}-${crypto.randomUUID()}`,
              source: file.name,
              date,
              vehicle: anchors[index].vehicle,
              litres,
            });
          }
        } catch {
          extracted.push({
            id: `${file.name}-${crypto.randomUUID()}`,
            source: file.name,
            date: REVIEW,
            vehicle: REVIEW,
            litres: REVIEW,
          });
        }
      }

      setReadings(extracted);
      setProgress(100);
      setStatus("done");
    } catch {
      setStatus("error");
    } finally {
      if (worker) await worker.terminate();
      setCurrentFile("");
    }
  }

  const hasResults = status === "done" && readings.length > 0;

  return (
    <main>
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">CG</div>
        <div>
          <p className="eyebrow">ESTABLECIMIENTO AGROPECUARIO</p>
          <h1>Control de gasoil</h1>
        </div>
        <div className="privacy-note">
          <span className="lock" aria-hidden="true">●</span>
          Procesamiento privado en este navegador
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="section-kicker">REGISTRO DE CARGAS</p>
          <h2>De una captura a un registro claro.</h2>
          <p className="hero-copy">
            Subí capturas del grupo de WhatsApp. La aplicación buscará la fecha,
            el vehículo y los litros sin completar datos dudosos.
          </p>
        </div>
        <div className="meter-decoration" aria-hidden="true">
          <span>LITROS</span>
          <strong>000.0</strong>
        </div>
      </section>

      <section className="workspace" aria-labelledby="upload-title">
        <div className="workspace-heading">
          <div>
            <p className="step">PASO 1</p>
            <h3 id="upload-title">Cargar capturas</h3>
          </div>
          {files.length > 0 && (
            <span className="file-count">
              {files.length} {files.length === 1 ? "imagen seleccionada" : "imágenes seleccionadas"}
            </span>
          )}
        </div>

        <div
          className={`dropzone ${dragging ? "is-dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={onFileChange}
          />
          <div className="upload-icon" aria-hidden="true">↑</div>
          <strong>Arrastrá las capturas acá</strong>
          <span>o hacé clic para elegir una o varias imágenes</span>
          <small>PNG, JPG o WEBP</small>
        </div>

        {files.length > 0 && (
          <div className="selection-row">
            <div className="selected-files" aria-label="Archivos seleccionados">
              {files.slice(0, 3).map((file) => (
                <span key={`${file.name}-${file.lastModified}`}>{file.name}</span>
              ))}
              {files.length > 3 && <span>+{files.length - 3} más</span>}
            </div>
            <button type="button" onClick={analyse} disabled={status === "processing"}>
              {status === "processing" ? "Analizando…" : "Analizar capturas"}
            </button>
          </div>
        )}

        {status === "processing" && (
          <div className="progress-panel" aria-live="polite">
            <div className="progress-copy">
              <span>Analizando {currentFile || "capturas"}</span>
              <strong>{progress}%</strong>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <small>La primera lectura puede demorar unos segundos.</small>
          </div>
        )}

        {status === "error" && (
          <p className="error-message" role="alert">
            No se pudieron analizar las imágenes. Volvé a intentarlo.
          </p>
        )}
      </section>

      <section className={`results ${hasResults ? "has-results" : ""}`} aria-labelledby="results-title">
        <div className="results-heading">
          <div>
            <p className="step">PASO 2</p>
            <h3 id="results-title">Resultado</h3>
          </div>
          {hasResults && (
            <p><span className="legend-dot" /> REVISAR indica una lectura poco segura</p>
          )}
        </div>

        {hasResults ? (
          <>
            <div className="total-card">
              <div>
                <span>TOTAL GENERAL</span>
                <strong>{formatLitres(totalLitres)} <small>litros</small></strong>
              </div>
              <p>Se suman únicamente las lecturas seguras.</p>
            </div>

            <div className="result-grid">
              <article className="table-card detail-card">
                <div className="card-title">
                  <div>
                    <span>DETALLE</span>
                    <h4>Cargas registradas</h4>
                  </div>
                  <strong>{readings.length}</strong>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Vehículo</th>
                        <th className="numeric">Litros</th>
                      </tr>
                    </thead>
                    <tbody>
                      {readings.map((reading) => (
                        <tr key={reading.id}>
                          <td>{reading.date === REVIEW ? <ReviewValue /> : reading.date}</td>
                          <td>{reading.vehicle === REVIEW ? <ReviewValue /> : reading.vehicle}</td>
                          <td className="numeric">
                            {reading.litres === REVIEW ? <ReviewValue /> : formatLitres(reading.litres)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="table-card summary-card">
                <div className="card-title">
                  <div>
                    <span>RESUMEN</span>
                    <h4>Consumo por vehículo</h4>
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Vehículo</th>
                        <th className="numeric">Cargas</th>
                        <th className="numeric">Litros</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map((item) => (
                        <tr key={item.vehicle}>
                          <td>{item.vehicle === REVIEW ? <ReviewValue /> : item.vehicle}</td>
                          <td className="numeric">{item.count}</td>
                          <td className="numeric">{formatLitres(item.litres)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <span aria-hidden="true">—</span>
            <p>Los resultados aparecerán acá después del análisis.</p>
          </div>
        )}
      </section>
    </main>
  );
}
