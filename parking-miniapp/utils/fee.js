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
 * 为停车场卡片提供可直接展示的价格。
 * min_price_hour 只是便于排序的小时价，并不是所有车场都有这个字段；
 * 例如“10 元/次”和“5 元/30 分钟”都应该优先按原收费单位展示。
 */
function displayPrice(rules, minPriceHour) {
  const list = Array.isArray(rules) ? rules : [];
  const priced = list.filter(rule => {
    const price = Number(rule && rule.price);
    return rule && Number.isFinite(price) && price >= 0 &&
      (rule.rule_type === 'first' || rule.rule_type === 'normal' || rule.rule_type === 'night');
  });
  const paid = priced.filter(item => Number(item.price) > 0);
  const rule = paid.find(item => item.rule_type === 'first') || paid[0] || priced[0];

  if (rule) {
    const price = Number(rule.price);
    if (price === 0) {
      return { hasPrice: true, value: '免费', unit: '', canCalculate: false };
    }
    if ((rule.unit === 'minute' || rule.unit === 'time') && Number(rule.unit_minutes) > 0) {
      return {
        hasPrice: true,
        value: fmt(price),
        unit: `${Number(rule.unit_minutes)}分钟`,
        hourlyValue: fmt(price * 60 / Number(rule.unit_minutes)),
        canCalculate: true
      };
    }
    if (rule.unit === 'time') {
      return { hasPrice: true, value: fmt(price), unit: '次', canCalculate: false };
    }
    if (rule.unit === 'day') {
      return { hasPrice: true, value: fmt(price), unit: '天', canCalculate: false };
    }
    if (rule.unit === 'month') {
      return { hasPrice: true, value: fmt(price), unit: '月', canCalculate: false };
    }
    return {
      hasPrice: true,
      value: fmt(price),
      unit: '小时',
      hourlyValue: fmt(price),
      canCalculate: true
    };
  }

  const hourly = minPriceHour == null || minPriceHour === '' ? null : Number(minPriceHour);
  if (hourly != null && Number.isFinite(hourly) && hourly >= 0) {
    return hourly === 0
      ? { hasPrice: true, value: '免费', unit: '', canCalculate: false }
      : { hasPrice: true, value: fmt(hourly), unit: '小时', hourlyValue: fmt(hourly), canCalculate: true };
  }

  const cap = list.find(item => item && item.rule_type === 'cap' && Number(item.price) >= 0);
  if (cap) {
    return { hasPrice: true, value: fmt(Number(cap.price)), unit: '封顶', canCalculate: false };
  }
  return null;
}

// 地点列表没有展开停车场明细，汇总所属停车场的最低小时价。
function placeDisplayPrice(parkings, minPrice) {
  const values = (Array.isArray(parkings) ? parkings : [])
    .map(item => displayPrice(item && item.fee_rules, item && item.min_price_hour))
    .map(item => item && item.hourlyValue)
    .filter(value => value != null && Number.isFinite(Number(value)) && Number(value) >= 0)
    .map(Number);
  if (!values.length) {
    const fallback = minPrice == null || minPrice === '' ? null : Number(minPrice);
    return fallback != null && Number.isFinite(fallback) && fallback >= 0
      ? { hasPrice: true, value: fmt(fallback), unit: 'h', suffix: '' }
      : null;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    hasPrice: true,
    value: fmt(min),
    unit: 'h',
    suffix: max > min ? '起' : ''
  };
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
    const unit = first.unit === 'month' ? '月' : (() => {
      const minutes = first.unit_minutes || 60;
      return minutes >= 60 ? minutes / 60 + '小时' : minutes + '分钟';
    })();
    parts.push(`${first.price} 元/${unit}`);
  }
  if (normal) {
    const unit = normal.unit === 'month' ? '月' : (() => {
      const minutes = normal.unit_minutes || 60;
      return minutes >= 60 ? minutes / 60 + '小时' : minutes + '分钟';
    })();
    parts.push(`后续 ${normal.price} 元/${unit}`);
  }
  if (cap) parts.push(`封顶 ${fmt(cap.price)} 元`);
  return parts.length ? parts.join('，') : '收费规则待补充';
}

module.exports = { calcFee, describeFee, displayPrice, placeDisplayPrice };
