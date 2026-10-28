import { Button, Toast } from '@douyinfe/semi-ui';
import type { FieldMetaLite } from '../../types';
import { getUi } from '../../services/appContext';

/**
 * 数据表「按钮」字段在前端的呈现。
 *
 * JSSDK 没有提供「触发按钮动作」的接口（FieldType/方法表里均无 Button 相关 API），
 * 按钮绑定的工作流只能由数据表自身执行。因此点击时调用宿主的
 * ui.showRecordDetailDialog 打开原生记录详情，用户在其中点击真实按钮即可执行，
 * 行为与原表一致；宿主不支持时降级为明确的 Toast 提示，不静默失败。
 */

/** 按钮配色索引（与数据表按钮调色板一致：1 红 2 橙 3 黄 4 绿 5 蓝 6 紫） */
const BUTTON_COLORS: Record<number, string> = {
  1: '#d83931',
  2: '#f59a23',
  3: '#d9990c',
  4: '#2ea121',
  5: '#3370ff',
  6: '#7f3bf5',
};

const DEFAULT_BUTTON_COLOR = '#3370ff';

function buttonColor(color?: number): string {
  if (!color) return DEFAULT_BUTTON_COLOR;
  return BUTTON_COLORS[color] ?? DEFAULT_BUTTON_COLOR;
}

let hintShown = false;

interface Props {
  tableId?: string;
  /** 记录 id（新增态还没有记录，无法执行按钮动作） */
  recordId?: string;
  field: FieldMetaLite;
  /** 按钮文案：优先用配置里的展示别名 */
  title?: string;
}

export function RecordButton({ tableId, recordId, field, title }: Props) {
  const text = title || field.buttonTitle || field.name || '按钮';
  const bg = buttonColor(field.buttonColor);

  const handleClick = async () => {
    if (!tableId) {
      Toast.warning('尚未配置数据表，无法执行按钮动作');
      return;
    }
    if (!recordId) {
      Toast.info('请先保存记录，保存后即可点击按钮执行');
      return;
    }
    const ui = getUi() as any;
    if (!ui || typeof ui.showRecordDetailDialog !== 'function') {
      Toast.warning('当前宿主不支持打开记录详情，请回到数据表中点击该按钮');
      return;
    }
    if (!hintShown) {
      hintShown = true;
      Toast.info('按钮动作由数据表执行：已在原生详情中打开该按钮，点击即可运行');
    }
    // 先只显示该按钮字段，失败时退回完整记录详情，避免弹出空白面板
    try {
      const ok = await ui.showRecordDetailDialog({ tableId, recordId, fieldIdList: [field.id] });
      if (ok !== false) return;
    } catch {
      /* 落到完整详情 */
    }
    try {
      const ok = await ui.showRecordDetailDialog({ tableId, recordId });
      if (ok === false) Toast.warning('宿主未打开记录详情，请回到数据表中点击该按钮');
    } catch (e) {
      Toast.error(`打开记录详情失败：${String((e as Error)?.message ?? e)}`);
    }
  };

  return (
    <Button
      className="record-button"
      theme="solid"
      style={{ background: bg, borderColor: bg, color: '#fff' }}
      onClick={() => void handleClick()}
    >
      {text}
    </Button>
  );
}