"""Human-readable labels for findings in the indexed data quality audit."""

FLAG_LABELS = {
    "label_missing": "无数值寿命标签",
    "label_invalid_number": "寿命标签不是正整数",
    "label_outside_detailed_cycles": "标签编号超出详细曲线最大 Cycle",
    "cell_soc_interval_invalid": "电池 SOC 区间格式或数值待核对",
    "charge_protocol_missing": "充电协议为空",
    "discharge_protocol_missing": "放电协议为空",
    "charge_protocol_invalid_shape": "充电协议结构待核对",
    "discharge_protocol_invalid_shape": "放电协议结构待核对",
    "charge_protocol_stage_without_numeric_control": "充电阶段没有数值控制项",
    "discharge_protocol_stage_without_numeric_control": "放电阶段没有数值控制项",
    "charge_protocol_soc_outside_0_1": "充电阶段 SOC 数值超出 0–1",
    "discharge_protocol_soc_outside_0_1": "放电阶段 SOC 数值超出 0–1",
}
