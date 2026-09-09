/**
 * 停车费计算器
 * 依据结构化收费规则（first / normal / cap / free）推算停车时长对应的费用
 * 规则不足时返回 null，由前端诚实显示「暂无计费规则」，不做估算
 */

function calcFee(rules, durationMinutes) {
  if (!rules || !rules.length) return null;

  const freeRule = rules.find(r => r.rule_type === 'free');
  const capRule = rules.find(r => r.rule_type === 'cap');
  const first = rules.find(r => r.rule_type === 'first');
  const normals = rules.filter(r => r.rule_type === 'normal' && r.price > 0);

  const freeMinutes = freeRule && freeRule.end_minute ? freeRule.end_minute : 0;
  const billable = Math.max(0, durationMinutes - freeMinutes);

  if (billable === 0) {
    return { total: 0, freeMinutes, steps: [`前 ${freeMinutes} 分钟免费`], capped: false };
  }
  if (!first && !normals.length) return null;

  let total = 0;
  const steps = [];

  if (first) {
    const segEnd = first.end_minute || 60;
    const unit = first.unit_minutes || 60;
    const used = Math.min(billable, segEnd);
    const cnt = Math.ceil(used / unit);
    const amt = cnt * first.price;
    total += amt;
    steps.push(`${unit >= 60 ? unit / 60 + '小时' : unit + '分钟'}内 ${first.price} 元 → ${fmt(amt)} 元`);

    if (billable > segEnd) {
      const rest = billable - segEnd;
      const n = normals[0];
      if (n) {
        const unit2 = n.unit_minutes || 60;
        const cnt2 = Math.ceil(rest / unit2);
        const amt2 = cnt2 * n.price;
        total += amt2;
        steps.push(`超出部分 ${n.price} 元/${unit2 >= 60 ? unit2 / 60 + '小时' : unit2 + '分钟'} × ${cnt2} → ${fmt(amt2)} 元`);
      }
    }
  } else {
    const n = normals[0];
    const unit = n.unit_minutes || 60;
    const cnt = Math.ceil(billable / unit);
    total = cnt * n.price;
    steps.push(`${n.price} 元/${unit >= 60 ? unit / 60 + '小时' : unit + '分钟'} × ${cnt} → ${fmt(total)} 元`);
  }

  let capped = false;
  if (capRule && total > capRule.price) {
    steps.push(`达到 24 小时封顶 ${fmt(capRule.price)} 元`);
    total = capRule.price;
    capped = true;
  }

  return { total: fmt(total), freeMinutes, steps, capped };
}

function fmt(n) {
  return Math.round(n * 100) / 100;
}

/**
 * 把 fee_rules 整理成一行人类可读的收费说明
 */
function describeFee(rules) {
  if (!rules || !rules.length) return '收费规则待补充';
  const first = rules.find(r => r.rule_type === 'first');
  const normal = rules.filter(r => r.rule_type === 'normal' && r.price > 0)[0];
  const cap = rules.find(r => r.rule_type === 'cap');

  const parts = [];
  if (first) {
    const unit = first.unit_minutes || 60;
    parts.push(`${first.price} 元/${unit >= 60 ? unit / 60 + '小时' : unit + '分钟'}`);
  }
  if (normal) {
    const unit = normal.unit_minutes || 60;
    parts.push(`后续 ${normal.price} 元/${unit >= 60 ? unit / 60 + '小时' : unit + '分钟'}`);
  }
  if (cap) parts.push(`封顶 ${fmt(cap.price)} 元`);
  return parts.length ? parts.join('，') : '收费规则待补充';
}

module.exports = { calcFee, describeFee };
