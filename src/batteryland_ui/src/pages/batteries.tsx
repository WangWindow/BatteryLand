import { useSelection } from "../app/context"
import { BatteryExplorer } from "../components/battery-explorer"
import { PageHeader } from "../components/common"

export default function BatteriesPage() {
  const { value, setValue } = useSelection()
  return (
    <>
      <PageHeader
        title="电池目录"
        description="打开物理数据集文件夹浏览电池，跨文件夹选择后保存为独立逻辑数据集。"
      />
      <BatteryExplorer selection={value} setSelection={setValue} />
    </>
  )
}
