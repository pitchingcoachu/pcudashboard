import fs from "node:fs";

const input = process.argv[2];
if (!input) throw new Error("Usage: node build-content-restyle-requests.mjs <raw-presentation.json>");

const root = JSON.parse(fs.readFileSync(input, "utf8"));
const deck = root.structuredContent ?? root;

const rgb = (red, green, blue) => ({ red, green, blue });
const COLORS = {
  black: rgb(0.03529412, 0.03921569, 0.04705882),
  red: rgb(0.78431373, 0.0627451, 0.18039216),
  deepRed: rgb(0.54117647, 0.08235294, 0.16470588),
  slate: rgb(0.23137255, 0.2627451, 0.32156863),
  paleRed: rgb(0.98431373, 0.91764706, 0.92941176),
  paleDeepRed: rgb(0.96470588, 0.89411765, 0.90980392),
  paleSlate: rgb(0.92941176, 0.9372549, 0.94901961),
  border: rgb(0.84705882, 0.8627451, 0.88627451),
  page: rgb(0.97254902, 0.97254902, 0.96470588),
};

const key = (color) => {
  if (!color) return null;
  return [color.red ?? 0, color.green ?? 0, color.blue ?? 0]
    .map((n) => Number(n).toFixed(4))
    .join(",");
};

const fillMap = new Map([
  ["0.1451,0.1608,0.1765", COLORS.black],
  ["0.1216,0.1451,0.1686", COLORS.black],
  ["0.1569,0.4196,0.2941", COLORS.red],
  ["0.8471,0.6039,0.1686", COLORS.slate],
  ["0.7216,0.2902,0.2392", COLORS.deepRed],
  ["0.8980,0.9412,0.9176", COLORS.paleRed],
  ["0.9765,0.9412,0.8549", COLORS.paleSlate],
  ["0.9686,0.8980,0.8824", COLORS.paleDeepRed],
  ["0.8471,0.8706,0.8235", COLORS.border],
]);

const textMap = new Map([
  ["0.1569,0.4196,0.2941", COLORS.red],
  ["0.8471,0.6039,0.1686", COLORS.slate],
  ["0.7216,0.2902,0.2392", COLORS.deepRed],
]);

const mapped = (color, map) => map.get(key(color)) ?? null;
const requests = [];

function textRequests(objectId, text) {
  for (const el of text?.textElements ?? []) {
    const run = el.textRun;
    if (!run) continue;
    const color = run.style?.foregroundColor?.opaqueColor?.rgbColor;
    const replacement = mapped(color, textMap);
    if (!replacement) continue;
    const endIndex = el.endIndex;
    const startIndex = el.startIndex ?? 0;
    requests.push({
      updateTextStyle: {
        objectId,
        textRange: { type: "FIXED_RANGE", startIndex, endIndex },
        style: { foregroundColor: { opaqueColor: { rgbColor: replacement } } },
        fields: "foregroundColor",
      },
    });
  }
}

for (const slide of deck.slides ?? []) {
  if (slide.objectId !== "p1") {
    requests.push({
      updatePageProperties: {
        objectId: slide.objectId,
        pageProperties: {
          pageBackgroundFill: { solidFill: { color: { rgbColor: COLORS.page } } },
        },
        fields: "pageBackgroundFill.solidFill.color",
      },
    });
  }

  for (const el of slide.pageElements ?? []) {
    const id = el.objectId;

    if (el.shape) {
      const props = el.shape.shapeProperties ?? {};
      const bg = props.shapeBackgroundFill?.solidFill?.color?.rgbColor;
      const outline = props.outline?.outlineFill?.solidFill?.color?.rgbColor;
      const bgReplacement = id === "lowder_intro_accent" ? COLORS.red : mapped(bg, fillMap);
      const outlineReplacement = id === "lowder_intro_accent" ? COLORS.red : mapped(outline, fillMap);
      const shapeProperties = {};
      const fields = [];
      if (bgReplacement) {
        shapeProperties.shapeBackgroundFill = {
          solidFill: { color: { rgbColor: bgReplacement } },
        };
        fields.push("shapeBackgroundFill.solidFill.color");
      }
      if (outlineReplacement) {
        shapeProperties.outline = {
          outlineFill: { solidFill: { color: { rgbColor: outlineReplacement } } },
        };
        fields.push("outline.outlineFill.solidFill.color");
      }
      if (fields.length) {
        requests.push({
          updateShapeProperties: {
            objectId: id,
            shapeProperties,
            fields: fields.join(","),
          },
        });
      }
      textRequests(id, el.shape.text);
    }

    if (el.line) {
      const color = el.line.lineProperties?.lineFill?.solidFill?.color?.rgbColor;
      const replacement = mapped(color, fillMap);
      if (replacement) {
        requests.push({
          updateLineProperties: {
            objectId: id,
            lineProperties: {
              lineFill: { solidFill: { color: { rgbColor: replacement } } },
            },
            fields: "lineFill.solidFill.color",
          },
        });
      }
    }

    if (el.table) {
      for (let rowIndex = 0; rowIndex < (el.table.tableRows ?? []).length; rowIndex += 1) {
        const row = el.table.tableRows[rowIndex];
        for (let columnIndex = 0; columnIndex < (row.tableCells ?? []).length; columnIndex += 1) {
          const cell = row.tableCells[columnIndex];
          const color =
            cell.tableCellProperties?.tableCellBackgroundFill?.solidFill?.color?.rgbColor;
          const replacement = mapped(color, fillMap);
          if (replacement) {
            requests.push({
              updateTableCellProperties: {
                objectId: id,
                tableRange: {
                  location: { rowIndex, columnIndex },
                  rowSpan: 1,
                  columnSpan: 1,
                },
                tableCellProperties: {
                  tableCellBackgroundFill: {
                    solidFill: { color: { rgbColor: replacement } },
                  },
                },
                fields: "tableCellBackgroundFill.solidFill.color",
              },
            });
          }
          textRequests(id, cell.text);
        }
      }
    }
  }
}

process.stdout.write(JSON.stringify(requests));
