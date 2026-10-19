import dayjs from 'dayjs';
import type { NotificationItem } from '../../api/types';

/** 通知对应的跳转地址：有缺陷编号跳详情，否则跳项目缺陷列表。 */
export function notificationLink(
  n: Pick<NotificationItem, 'projectKey' | 'defectCode'>,
): string | null {
  if (!n.projectKey) return null;
  return n.defectCode ? `/p/${n.projectKey}/bugs/${n.defectCode}` : `/p/${n.projectKey}/bugs`;
}

/** 列表里的时间：今天、昨天只显示时分，今年显示月日，更早带年份。 */
export function notificationTime(createdAt: string, now: Date = new Date()): string {
  const at = dayjs(createdAt);
  const today = dayjs(now).startOf('day');
  if (!at.isBefore(today)) return `今天 ${at.format('HH:mm')}`;
  if (!at.isBefore(today.subtract(1, 'day'))) return `昨天 ${at.format('HH:mm')}`;
  if (at.year() === today.year()) return at.format('MM-DD HH:mm');
  return at.format('YYYY-MM-DD HH:mm');
}
