import { Navigate, useParams } from 'react-router-dom';

/** 新建缺陷已改为列表页内的弹窗；保留旧地址，跳到列表并打开弹窗 */
export function DefectCreatePage() {
  const { key = '' } = useParams();
  return <Navigate to={`/p/${key}/bugs?create=1`} replace />;
}
