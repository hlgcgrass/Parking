/**
 * 端上查询：镜像云函数 buildList / searchPlaces / nearbyPlaces / getDetailStatic 逻辑
 * ------------------------------------------------------------
 * 作用于 cache.getStatic() 返回的静态数据集（缓存到 wx.setStorage 的那份）。
 * 复用 haversine / scaleOf / CONF_TEXT，保证端上与云上结果一致。
 * 所有方法都是纯函数，无网络、无副作用。
 */
const R = 6371000;
function haversine(lat1, lng1, lat2, lng2) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
function scaleOf(total) {
  if (total == null) return null;
  if (total >= 500) return '大型车场';
  if (total >= 200) return '中型车场';
  return '小型车场';
}
const CONF_TEXT = {
  high: '来源：官方价目表',
  medium: '来源：公开信息整理',
  low: '信息未核实，以现场为准'
};

// 构建索引（parkingsByPlace / parkingById / tipsByPlace），结果缓存到 s._maps 避免重复计算
function ensureMaps(s) {
  if (s._maps) return s._maps;
  const parkingsByPlace = {};
  const parkingById = {};
  for (const pk of (s.parkings || [])) {
    const pid = pk.place_id;
    (parkingsByPlace[pid] = parkingsByPlace[pid] || []).push(pk);
    parkingById[pk.id] = Object.assign({}, pk, { place_name: '' });
  }
  for (const p of (s.places || [])) {
    for (const pk of (parkingsByPlace[p.id] || [])) parkingById[pk.id].place_name = p.name;
  }
  const tipsByPlace = {};
  for (const t of (s.tips || [])) {
    if (t.status && t.status !== 'ok') continue;
    (tipsByPlace[t.place_id] = tipsByPlace[t.place_id] || []).push({
      category: t.category, content: t.content, source: t.source
    });
  }
  s._maps = { parkingsByPlace, parkingById, tipsByPlace };
  return s._maps;
}

function city0(s) {
  return (s.meta && s.meta.cities && s.meta.cities[0]) || null;
}

function buildList(s, { cityCode, category, keyword, page = 1, size = 20, lat, lng, sort = 'heat' }) {
  let list = (s.places || []).filter(p => {
    if (cityCode && String(p.city_code || '440100') !== String(cityCode)) return false;
    if (category && category !== '全部' && p.category !== category) return false;
    if (keyword) {
      const kw = String(keyword).toLowerCase();
      const hay = `${p.name || ''} ${p.address || ''} ${p.search_text || ''} ${(p.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
  list.sort((a, b) => {
    if (sort === 'view') return (b.view_count || 0) - (a.view_count || 0);
    return (b.heat || 0) - (a.heat || 0) || a.id - b.id;
  });
  const sizeN = Math.min(size || 20, 50);
  const offset = (Math.max(1, page || 1) - 1) * sizeN;
  return list.slice(offset, offset + sizeN).map(p => {
    const out = Object.assign({}, p);
    if (lat != null && lng != null && p.lat != null && p.lng != null) out.distance_m = haversine(lat, lng, p.lat, p.lng);
    return out;
  });
}

function searchPlaces(s, keyword, cityCode, limit = 20) {
  if (!keyword) return [];
  const kw = String(keyword).toLowerCase();
  return (s.places || [])
    .filter(p => {
      if (cityCode && String(p.city_code || '440100') !== String(cityCode)) return false;
      const hay = `${p.name || ''} ${p.address || ''} ${p.search_text || ''}`.toLowerCase();
      return hay.includes(kw);
    })
    .map(p => {
      const name = (p.name || '').toLowerCase();
      let rank = 2;
      if (name === kw) rank = 0; else if (name.startsWith(kw)) rank = 1;
      return Object.assign({}, p, { _rank: rank });
    })
    .sort((a, b) => a._rank - b._rank || (b.heat || 0) - (a.heat || 0))
    .slice(0, Math.min(limit || 20, 50))
    .map(({ _rank, ...p }) => p);
}

function nearbyPlaces(s, lat, lng, radius = 3000, limit = 20) {
  const maps = ensureMaps(s);
  return (s.places || [])
    .filter(p => p.lat != null && p.lng != null)
    .map(p => Object.assign({}, p, { distance_m: haversine(lat, lng, p.lat, p.lng) }))
    .filter(p => p.distance_m <= radius)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, Math.min(limit || 20, 50))
    .map(p => {
      const top = (maps.parkingsByPlace[p.id] || [])[0];
      return {
        id: p.id, name: p.name, category: p.category, address: p.address, district: p.district,
        lng: p.lng, lat: p.lat, parking_count: p.parking_count, min_price: p.min_price,
        top_parking: top ? top.name : null, distance_m: p.distance_m
      };
    });
}

function getDetailStatic(s, id, lat, lng, sort, favSet, likeSet) {
  const maps = ensureMaps(s);
  const place = (s.places || []).find(p => p.id === Number(id));
  if (!place) return null;

  const raw = maps.parkingsByPlace[place.id] || [];
  let parkingList = raw.map(pk => {
    const out = Object.assign({}, pk, {
      scale: scaleOf(pk.total_spots),
      confidence_text: CONF_TEXT[pk.confidence] || CONF_TEXT.medium
    });
    if (lat != null && lng != null && pk.lat != null && pk.lng != null) {
      out.user_distance_m = haversine(lat, lng, pk.lat, pk.lng);
    }
    out.like_count = pk.like_count || 0;
    out.is_favorited = favSet.has(pk.id);
    out.is_liked = likeSet.has(pk.id);
    return out;
  });

  if (sort === 'like') {
    parkingList.sort((a, b) => (b.like_count || 0) - (a.like_count || 0) || (a.min_price_hour || 999) - (b.min_price_hour || 999));
  }

  const c0 = city0(s);
  return {
    id: place.id, name: place.name, category: place.category, address: place.address,
    district: place.district, city_name: (c0 && c0.name) || '广州',
    city_code: (c0 && c0.code) || '440100', lng: place.lng, lat: place.lat,
    heat: place.heat, summary: place.summary, tags: place.tags || [], area_tips: place.area_tips,
    updated_at: place.updated_at, parkings: parkingList, tips: maps.tipsByPlace[place.id] || []
  };
}

function cities(s) { return (s.meta && s.meta.cities) || []; }
function categories(s) { return (s.meta && s.meta.categories) || []; }
function stats(s) {
  const maps = ensureMaps(s);
  const parkingsCount = Object.keys(maps.parkingsByPlace).reduce((n, k) => n + maps.parkingsByPlace[k].length, 0);
  return {
    cities: (s.meta && s.meta.cities) ? s.meta.cities.length : 0,
    places: (s.places || []).length,
    parkings: parkingsCount,
    fee_rules: (s.meta && s.meta.fee_rules) || 0,
    updated_at: (s.meta && s.meta.updated_at) || null
  };
}

module.exports = { ensureMaps, buildList, searchPlaces, nearbyPlaces, getDetailStatic, cities, categories, stats };
