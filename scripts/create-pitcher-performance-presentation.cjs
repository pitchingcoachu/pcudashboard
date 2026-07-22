const pptxgen = require("pptxgenjs");

const pptx = new pptxgen();
pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
pptx.layout = "WIDE";
pptx.author = "Pitching Coach U";
pptx.company = "Pitching Coach U";
pptx.subject = "How to evaluate a pitcher's performance";
pptx.title = "How to Evaluate a Pitcher's Performance";
pptx.lang = "en-US";
pptx.theme = {
  headFontFace: "Arial",
  bodyFontFace: "Arial",
  lang: "en-US",
};

const C = {
  ink: "1F252B",
  muted: "5C6670",
  bg: "F7F8F4",
  white: "FFFFFF",
  line: "D8DED2",
  green: "286B4B",
  green2: "4D8B66",
  amber: "D89A2B",
  red: "B84A3D",
  blue: "356C9F",
  charcoal: "25292D",
};

function title(slide, text) {
  slide.background = { color: C.bg };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.36,
    fill: { color: C.charcoal },
    line: { color: C.charcoal },
  });
  slide.addText(text, {
    x: 0.62,
    y: 0.73,
    w: 11.8,
    h: 0.44,
    margin: 0,
    fontFace: "Arial",
    fontSize: 24,
    bold: true,
    color: C.ink,
    fit: "shrink",
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.62,
    y: 1.34,
    w: 12.05,
    h: 0,
    line: { color: C.line, width: 1 },
  });
}

function footer(slide, n) {
  slide.addText(String(n).padStart(2, "0"), {
    x: 12.28,
    y: 7.05,
    w: 0.45,
    h: 0.16,
    margin: 0,
    fontSize: 8,
    bold: true,
    color: C.muted,
    align: "right",
  });
}

function card(slide, x, y, w, h, heading, body, accent = C.green) {
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y,
    w,
    h,
    fill: { color: C.white },
    line: { color: C.line, width: 1 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y,
    w: 0.08,
    h,
    fill: { color: accent },
    line: { color: accent },
  });
  slide.addText(heading, {
    x: x + 0.26,
    y: y + 0.24,
    w: w - 0.52,
    h: 0.26,
    margin: 0,
    fontSize: 18,
    bold: true,
    color: C.ink,
    fit: "shrink",
  });
  slide.addText(body, {
    x: x + 0.26,
    y: y + 0.78,
    w: w - 0.52,
    h: h - 0.95,
    margin: 0,
    fontSize: 15,
    color: C.muted,
    fit: "shrink",
    breakLine: false,
    valign: "top",
  });
}

function metricColumn(slide, x, heading, mlb, college, accent) {
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y: 1.85,
    w: 3.65,
    h: 3.95,
    fill: { color: C.white },
    line: { color: C.line, width: 1 },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y: 1.85,
    w: 3.65,
    h: 0.72,
    fill: { color: accent },
    line: { color: accent },
  });
  slide.addText(heading, {
    x,
    y: 2.07,
    w: 3.65,
    h: 0.22,
    margin: 0,
    fontSize: 18,
    bold: true,
    color: C.white,
    align: "center",
    fit: "shrink",
  });
  slide.addText("MLB Average", {
    x: x + 0.35,
    y: 3.15,
    w: 2.95,
    h: 0.2,
    margin: 0,
    fontSize: 12,
    bold: true,
    color: C.muted,
    align: "center",
  });
  slide.addText(mlb, {
    x: x + 0.35,
    y: 3.48,
    w: 2.95,
    h: 0.46,
    margin: 0,
    fontSize: 30,
    bold: true,
    color: C.ink,
    align: "center",
    fit: "shrink",
  });
  slide.addShape(pptx.ShapeType.line, {
    x: x + 0.62,
    y: 4.28,
    w: 2.4,
    h: 0,
    line: { color: C.line, width: 1 },
  });
  slide.addText("College Average", {
    x: x + 0.35,
    y: 4.6,
    w: 2.95,
    h: 0.2,
    margin: 0,
    fontSize: 12,
    bold: true,
    color: C.muted,
    align: "center",
  });
  slide.addText(college, {
    x: x + 0.35,
    y: 4.93,
    w: 2.95,
    h: 0.46,
    margin: 0,
    fontSize: 30,
    bold: true,
    color: accent,
    align: "center",
    fit: "shrink",
  });
}

function node(slide, text, x, y, w, h, fill, color = C.white, fontSize = 12) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: fill },
    line: { color: fill, width: 1 },
  });
  slide.addText(text, {
    x: x + 0.06,
    y: y + h / 2 - 0.09,
    w: w - 0.12,
    h: 0.16,
    margin: 0,
    fontSize,
    bold: true,
    color,
    align: "center",
    fit: "shrink",
  });
}

function connector(slide, x1, y1, x2, y2, color = C.line) {
  slide.addShape(pptx.ShapeType.line, {
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1,
    line: { color, width: 1.15, beginArrowType: "none", endArrowType: "triangle" },
  });
}

// Slide 1
{
  const slide = pptx.addSlide();
  slide.background = { color: C.charcoal };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.7,
    y: 0.62,
    w: 11.95,
    h: 6.25,
    fill: { color: C.charcoal, transparency: 100 },
    line: { color: "6B746F", width: 1.2, dash: "dash" },
  });
  slide.addText("PHOTO PLACEHOLDER", {
    x: 4.62,
    y: 3.46,
    w: 4.1,
    h: 0.18,
    margin: 0,
    fontSize: 10,
    bold: true,
    color: "9EA9A2",
    align: "center",
    charSpace: 1.2,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 4.9,
    w: 13.333,
    h: 2.6,
    fill: { color: C.charcoal, transparency: 9 },
    line: { color: C.charcoal, transparency: 100 },
  });
  slide.addText("How to Evaluate a\nPitcher's Performance", {
    x: 0.85,
    y: 5.15,
    w: 9.9,
    h: 1.15,
    margin: 0,
    fontSize: 38,
    bold: true,
    color: C.white,
    fit: "shrink",
    breakLine: false,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.85,
    y: 6.53,
    w: 2.1,
    h: 0.08,
    fill: { color: C.amber },
    line: { color: C.amber },
  });
}

// Slide 2
{
  const slide = pptx.addSlide();
  title(slide, "The Big 3");
  footer(slide, 2);
  card(slide, 0.82, 1.9, 3.55, 3.85, "K%", "Generate swing and miss", C.green);
  card(slide, 4.89, 1.9, 3.55, 3.85, "BB%", "Limit free bases", C.amber);
  card(slide, 8.96, 1.9, 3.55, 3.85, "Barrel%", "Limit damage", C.red);
}

// Slide 3
{
  const slide = pptx.addSlide();
  title(slide, "Why Use Rates Instead of /9?");
  footer(slide, 3);
  slide.addText("Rates tell us more accurately how a pitcher performs per batter they face.", {
    x: 0.85,
    y: 1.85,
    w: 11.4,
    h: 0.5,
    margin: 0,
    fontSize: 23,
    bold: true,
    color: C.ink,
    fit: "shrink",
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.9,
    y: 3.0,
    w: 5.4,
    h: 2.15,
    fill: { color: C.white },
    line: { color: C.line, width: 1 },
  });
  slide.addText("Pitcher A", {
    x: 1.25,
    y: 3.36,
    w: 1.5,
    h: 0.22,
    margin: 0,
    fontSize: 14,
    bold: true,
    color: C.green,
  });
  slide.addText("2 strikeouts\n3 batters faced", {
    x: 1.25,
    y: 3.9,
    w: 4.2,
    h: 0.6,
    margin: 0,
    fontSize: 24,
    bold: true,
    color: C.ink,
    breakLine: false,
    fit: "shrink",
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 7.03,
    y: 3.0,
    w: 5.4,
    h: 2.15,
    fill: { color: C.white },
    line: { color: C.line, width: 1 },
  });
  slide.addText("Pitcher B", {
    x: 7.38,
    y: 3.36,
    w: 1.5,
    h: 0.22,
    margin: 0,
    fontSize: 14,
    bold: true,
    color: C.amber,
  });
  slide.addText("2 strikeouts\n5 batters faced", {
    x: 7.38,
    y: 3.9,
    w: 4.2,
    h: 0.6,
    margin: 0,
    fontSize: 24,
    bold: true,
    color: C.ink,
    breakLine: false,
    fit: "shrink",
  });
  slide.addText("Same inning total. Different performance per opportunity.", {
    x: 2.15,
    y: 6.1,
    w: 9.0,
    h: 0.3,
    margin: 0,
    fontSize: 17,
    bold: true,
    color: C.muted,
    align: "center",
    fit: "shrink",
  });
}

// Slide 4
{
  const slide = pptx.addSlide();
  title(slide, "K%, BB%, Barrel%");
  footer(slide, 4);
  metricColumn(slide, 0.85, "K%", "22.5%", "20%", C.green);
  metricColumn(slide, 4.84, "BB%", "8.7%", "11%", C.amber);
  metricColumn(slide, 8.83, "Barrel%", "18%", "17%", C.red);
}

// Slide 5
{
  const slide = pptx.addSlide();
  title(slide, "Decision Tree");
  footer(slide, 5);

  const topY = 1.65;
  const handY = 2.85;
  const weakY = 4.05;
  const usageY = 6.25;
  const groups = [
    { metric: "K%", x: 0.88, color: C.green, weak: ["Whiff%", "CSW%", "Stuff"] },
    { metric: "BB%", x: 4.74, color: C.amber, weak: ["InZone%", "Strike%", "FPS%", "E+A%"] },
    { metric: "Barrel%", x: 8.6, color: C.red, weak: ["Location", "GB%"] },
  ];

  groups.forEach((g) => {
    node(slide, g.metric, g.x + 0.95, topY, 1.35, 0.55, g.color, C.white, 15);
    node(slide, "RHH", g.x + 0.15, handY, 1.18, 0.44, C.white, C.ink, 11);
    node(slide, "LHH", g.x + 2.07, handY, 1.18, 0.44, C.white, C.ink, 11);
    connector(slide, g.x + 1.62, topY + 0.55, g.x + 0.74, handY, g.color);
    connector(slide, g.x + 1.62, topY + 0.55, g.x + 2.66, handY, g.color);

    const weakText = g.weak.join("\n");
    node(slide, weakText, g.x + 0.25, weakY, 3.0, 0.92, "FFFFFF", C.ink, 10.5);
    connector(slide, g.x + 0.74, handY + 0.44, g.x + 1.08, weakY, C.line);
    connector(slide, g.x + 2.66, handY + 0.44, g.x + 2.38, weakY, C.line);
  });

  slide.addShape(pptx.ShapeType.line, {
    x: 2.35,
    y: 5.3,
    w: 8.7,
    h: 0,
    line: { color: C.line, width: 1.2 },
  });
  groups.forEach((g) => connector(slide, g.x + 1.75, weakY + 0.92, 6.67, usageY, C.line));
  node(slide, "Pitch Usage", 5.25, usageY, 2.85, 0.55, C.charcoal, C.white, 14);
  slide.addText("Determine the weak link by batter handedness, then check whether pitch usage supports or explains the result.", {
    x: 1.2,
    y: 6.9,
    w: 10.9,
    h: 0.2,
    margin: 0,
    fontSize: 9.5,
    color: C.muted,
    align: "center",
    fit: "shrink",
  });
}

pptx.writeFile({ fileName: "Pitcher Performance Evaluation - Staff Presentation.pptx" });
