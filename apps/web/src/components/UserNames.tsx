import type { Member } from '../api/types';

/** 把用户 id 显示为成员姓名；不在成员列表中的显示为“已移除成员”。 */
export function userName(members: Member[], id: string | null | undefined): string {
  if (!id) return '—';
  return members.find((m) => m.id === id)?.name ?? '已移除成员';
}

export function UserNames({ members, ids }: { members: Member[]; ids: (string | null)[] }) {
  const names = ids.filter(Boolean).map((id) => userName(members, id));
  return <span>{names.length ? names.join('、') : '—'}</span>;
}
