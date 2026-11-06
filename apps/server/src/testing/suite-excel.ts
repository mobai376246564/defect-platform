import ExcelJS from 'exceljs';
import {
  DEFAULT_SUITE_NOTES,
  summarizeTestPoints,
  TEST_CASE_COLUMNS,
  TEST_CASE_MODE,
  TEST_PRIORITIES,
  TEST_RESULT,
  TEST_SUITE_FIXED_SHEETS,
  type TestCaseColumnKey,
  type TestCaseMode,
  type TestResult,
} from '@defect/shared';

/** 导出 / 导入用到的用例字段 */
export interface ExcelCase {
  sheet: string;
  code: string;
  module: string;
  subModule: string;
  testPoint: string;
  title: string;
  priority: string;
  caseType: string;
  precondition: string;
  steps: string;
  expected: string;
  actualResult: string;
  result: TestResult;
  remark: string;
  mode: TestCaseMode;
  defectCode?: string | null;
}

export interface ExcelSuite {
  name: string;
  docName: string;
  source: string;
  notes: string[];
  sheets: { name: string; module: string }[];
  cases: ExcelCase[];
  questions: { module: string; question: string; answer: string; confirmer: string }[];
}

/** 解析结果：用例的结果、执行方式还是中文标签，交给 DTO 校验时再转成 key */
export type ParsedSuite = Omit<ExcelSuite, 'cases'> & {
  cases: (Omit<ExcelCase, 'result' | 'mode'> & { result: string; mode?: string })[];
};

// ---------- 样式（与团队用例表一致：深蓝表头、白色粗体、细边框、P0 红色粗体） ----------

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F4E78' },
};
const THIN = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = BORDER;
  });
}

function styleBody(row: ExcelJS.Row, wrap = true): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = BORDER;
    cell.alignment = { vertical: 'top', wrapText: wrap };
  });
}

/** 一个下拉列表的数据验证（测试结果、执行方式） */
function listValidation(values: readonly string[]): ExcelJS.DataValidation {
  return { type: 'list', allowBlank: true, formulae: [`"${values.join(',')}"`] };
}

/**
 * 生成与团队用例表结构一致的 Excel：概览、测试点汇总、需求待确认，然后每个模块一个工作表。
 * 关联的缺陷编号写进备注列（Excel 没有单独的列）。
 */
export async function buildSuiteWorkbook(suite: ExcelSuite): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheetNames = suite.sheets.map((s) => s.name);

  // 概览
  const ov = wb.addWorksheet(TEST_SUITE_FIXED_SHEETS.overview);
  ov.columns = [38, 18, 16, 10, 8, 8, 8, 8].map((width) => ({ width }));
  ov.getCell('A1').value = suite.name;
  ov.getCell('A1').font = { bold: true, size: 14 };
  ov.getCell('A3').value = '需求来源';
  ov.getCell('A3').font = { bold: true };
  ov.getCell('A4').value = suite.source;
  const head = ov.getRow(6);
  head.values = ['需求文档', '模块', '工作表', '用例数', ...TEST_PRIORITIES];
  styleHeader(head);
  suite.sheets.forEach((s, i) => {
    const list = suite.cases.filter((c) => c.sheet === s.name);
    const row = ov.getRow(7 + i);
    row.values = [
      suite.docName,
      s.module || s.name,
      s.name,
      list.length,
      ...TEST_PRIORITIES.map((p) => list.filter((c) => c.priority === p).length),
    ];
    styleBody(row, false);
  });
  const first = 7;
  const last = 6 + suite.sheets.length;
  const total = ov.getRow(last + 1);
  total.values = [
    '合计',
    '',
    '',
    ...['D', 'E', 'F', 'G', 'H'].map((col) => ({
      formula: `SUM(${col}${first}:${col}${last})`,
    })),
  ] as ExcelJS.CellValue[];
  styleBody(total, false);
  total.getCell(1).font = { bold: true };
  (suite.notes.length ? suite.notes : DEFAULT_SUITE_NOTES).forEach((n, i) => {
    ov.getCell(`A${last + 3 + i}`).value = n;
  });

  // 测试点汇总
  const pts = wb.addWorksheet(TEST_SUITE_FIXED_SHEETS.points, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  pts.columns = [6, 18, 16, 16, 20, 10, 50].map((width) => ({ width }));
  styleHeader(
    pts.addRow(['序号', '需求文档', '模块', '子模块', '测试点', '关联用例数', '关联用例编号']),
  );
  summarizeTestPoints(suite.cases, sheetNames).forEach((p, i) => {
    styleBody(
      pts.addRow([
        i + 1,
        suite.docName,
        p.module,
        p.subModule,
        p.testPoint,
        p.codes.length,
        p.codes.join('、'),
      ]),
    );
  });

  // 需求待确认
  const qs = wb.addWorksheet(TEST_SUITE_FIXED_SHEETS.questions, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  qs.columns = [6, 18, 14, 80, 30, 10].map((width) => ({ width }));
  styleHeader(qs.addRow(['序号', '需求文档', '模块', '问题描述', '确认结果', '确认人']));
  suite.questions.forEach((q, i) => {
    styleBody(qs.addRow([i + 1, suite.docName, q.module, q.question, q.answer, q.confirmer]));
  });

  // 各模块工作表
  const resultLabels = Object.values(TEST_RESULT);
  const resultCol = TEST_CASE_COLUMNS.findIndex((c) => c.key === 'result') + 1;
  const modeCol = TEST_CASE_COLUMNS.findIndex((c) => c.key === 'mode') + 1;
  const priorityCol = TEST_CASE_COLUMNS.findIndex((c) => c.key === 'priority') + 1;
  for (const s of suite.sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = TEST_CASE_COLUMNS.map((c) => ({ width: c.width }));
    styleHeader(ws.addRow(TEST_CASE_COLUMNS.map((c) => c.label)));
    const list = suite.cases.filter((c) => c.sheet === s.name);
    for (const c of list) {
      const remark = c.defectCode
        ? [c.remark, `缺陷 ${c.defectCode}`].filter(Boolean).join('；')
        : c.remark;
      const values: Record<TestCaseColumnKey, string> = {
        code: c.code,
        docName: suite.docName,
        module: c.module,
        subModule: c.subModule,
        testPoint: c.testPoint,
        title: c.title,
        priority: c.priority,
        caseType: c.caseType,
        precondition: c.precondition,
        steps: c.steps,
        expected: c.expected,
        actualResult: c.actualResult,
        result: TEST_RESULT[c.result],
        remark,
        mode: TEST_CASE_MODE[c.mode],
      };
      const row = ws.addRow(TEST_CASE_COLUMNS.map((col) => values[col.key]));
      styleBody(row);
      const pCell = row.getCell(priorityCol);
      pCell.alignment = { vertical: 'top', horizontal: 'center' };
      if (c.priority === 'P0') pCell.font = { bold: true, color: { argb: 'FFC00000' } };
    }
    const lastRow = Math.max(list.length + 1, 2);
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: lastRow, column: TEST_CASE_COLUMNS.length },
    };
    for (let r = 2; r <= lastRow; r++) {
      ws.getCell(r, resultCol).dataValidation = listValidation(resultLabels);
      ws.getCell(r, modeCol).dataValidation = listValidation(Object.values(TEST_CASE_MODE));
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- 导入 ----------

/** 单元格里的文字：兼容富文本、公式结果、超链接、数字与日期 */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v)
      return v.richText
        .map((t) => t.text)
        .join('')
        .trim();
    if ('text' in v && typeof v.text === 'string') return v.text.trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
  }
  return '';
}

function rowTexts(ws: ExcelJS.Worksheet, r: number): string[] {
  const row = ws.getRow(r);
  const out: string[] = [];
  for (let c = 1; c <= Math.max(row.cellCount, ws.columnCount); c++)
    out.push(cellText(row.getCell(c).value));
  return out;
}

/** 表头里某一列的位置（1 起），没有返回 0 */
const colOf = (header: string[], label: string) => header.indexOf(label) + 1;

/**
 * 解析团队格式的用例 Excel。
 * - 含「用例编号」「用例标题」表头的工作表视为模块工作表；
 * - 「需求待确认」读问题、确认结果、确认人；
 * - 「概览」读标题（文件名）、需求来源、模块与工作表的对应、底部说明。
 * 「测试点汇总」由用例汇总得出，不读取。
 * @param fileName 上传的文件名，概览里没有标题时用它做文件名
 */
export async function parseSuiteWorkbook(buffer: Buffer, fileName: string): Promise<ParsedSuite> {
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs 的类型声明还是旧版 Buffer，运行时接受任意 Buffer
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new Error('无法读取文件，请上传 .xlsx 格式的 Excel');
  }

  const result: ParsedSuite = {
    name: fileName.replace(/\.xlsx$/i, '').trim(),
    docName: '',
    source: '',
    notes: [],
    sheets: [],
    cases: [],
    questions: [],
  };
  const moduleOfSheet = new Map<string, string>();

  for (const ws of wb.worksheets) {
    const header = rowTexts(ws, 1);

    if (ws.name === TEST_SUITE_FIXED_SHEETS.overview) {
      const title = cellText(ws.getCell('A1').value);
      if (title) result.name = title;
      let tableStart = 0;
      for (let r = 1; r <= ws.rowCount; r++) {
        const cells = rowTexts(ws, r);
        if (cells[0] === '需求来源') result.source = rowTexts(ws, r + 1).find(Boolean) ?? '';
        if (cells[0] === '需求文档' && cells.includes('工作表')) {
          tableStart = r;
          const mCol = cells.indexOf('模块');
          const sCol = cells.indexOf('工作表');
          for (let rr = r + 1; rr <= ws.rowCount; rr++) {
            const row = rowTexts(ws, rr);
            if (!row[0] || row[0] === '合计') {
              tableStart = rr;
              break;
            }
            if (row[sCol]) moduleOfSheet.set(row[sCol], row[mCol] ?? '');
          }
        }
      }
      // 合计行之后的文字就是说明
      if (tableStart) {
        for (let r = tableStart + 1; r <= ws.rowCount; r++) {
          const t = rowTexts(ws, r).find(Boolean);
          if (t) result.notes.push(t.slice(0, 500));
        }
      }
      continue;
    }

    if (ws.name === TEST_SUITE_FIXED_SHEETS.questions || colOf(header, '问题描述')) {
      const mCol = colOf(header, '模块');
      const qCol = colOf(header, '问题描述');
      const aCol = colOf(header, '确认结果');
      const pCol = colOf(header, '确认人');
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const question = cellText(row.getCell(qCol).value);
        if (!question) continue;
        result.questions.push({
          module: mCol ? cellText(row.getCell(mCol).value) : '',
          question,
          answer: aCol ? cellText(row.getCell(aCol).value) : '',
          confirmer: pCol ? cellText(row.getCell(pCol).value) : '',
        });
      }
      continue;
    }

    if (!colOf(header, '用例编号') || !colOf(header, '用例标题')) continue;

    // 模块工作表：按表头文字取列，列的顺序、多出的列都不影响
    const cols = Object.fromEntries(
      TEST_CASE_COLUMNS.map((c) => [c.key, colOf(header, c.label)]),
    ) as Record<TestCaseColumnKey, number>;
    const get = (row: ExcelJS.Row, key: TestCaseColumnKey) =>
      cols[key] ? cellText(row.getCell(cols[key]).value) : '';
    let firstModule = '';
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const code = get(row, 'code');
      const title = get(row, 'title');
      if (!code && !title) continue;
      if (!result.docName) result.docName = get(row, 'docName');
      const module = get(row, 'module') || ws.name;
      if (!firstModule) firstModule = module;
      result.cases.push({
        sheet: ws.name,
        code,
        module,
        subModule: get(row, 'subModule'),
        testPoint: get(row, 'testPoint'),
        title,
        priority: get(row, 'priority') || 'P2',
        caseType: get(row, 'caseType') || '功能',
        precondition: get(row, 'precondition'),
        steps: get(row, 'steps'),
        expected: get(row, 'expected'),
        actualResult: get(row, 'actualResult'),
        result: get(row, 'result'),
        remark: get(row, 'remark'),
        mode: get(row, 'mode') || undefined,
      });
    }
    result.sheets.push({
      name: ws.name,
      module: moduleOfSheet.get(ws.name) || firstModule || ws.name,
    });
  }

  if (result.cases.length === 0) {
    throw new Error('没有找到用例：模块工作表的第一行需要有「用例编号」「用例标题」等表头');
  }
  return result;
}
