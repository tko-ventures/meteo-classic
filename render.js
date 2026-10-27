// render.js — draws a meteogram in the old meteo.pl (UM 4 km) layout onto a 2D canvas context.
// Works in the browser (HTMLCanvasElement) and in Node (@napi-rs/canvas).

const FONT_FAMILY = "Arial, 'Liberation Sans', Helvetica, sans-serif"
const API_ORIGIN = 'https://devmgramapi.meteo.pl'
const DEFAULT_TIME_ZONE = 'Europe/Warsaw'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const DEG_TO_RAD = Math.PI / 180

// ---------- ICM palettes (from the meteo.pl source) ----------

function parseColors(list) {
	return list.trim().split(/\s+/)
}

function expandPalette(spec) {
	return spec.flatMap(([count, rgb]) =>
		Array.from({ length: count }, () => `rgb(${rgb})`),
	)
}

const PRESSURE_STEPS = parseColors(`
	235,240,240 210,230,230 195,220,220 180,210,210 165,200,200 150,190,190
	135,180,185 120,170,180 105,165,170 90,160,160 75,140,160 60,120,140
	45,90,110 30,70,90 15,50,70 15,35,90 15,20,130 15,35,150 15,60,180
	15,90,210 15,120,240 15,150,255 15,180,255 15,220,255 15,255,255
	0,255,210 0,235,140 0,205,70 0,170,0 0,205,0 50,235,0 100,255,0
	150,255,0 200,255,20 255,255,0 255,215,0 255,175,0 255,135,0 250,95,0
	245,55,0 240,25,0 235,0,30 230,15,60 225,30,90 220,45,120 215,60,150
	210,75,180 205,90,210 215,105,240 225,120,255 235,135,255 245,150,255
	255,165,255 245,180,245 235,195,235 225,205,225 215,215,215 220,220,220
	225,225,225 230,230,230 235,235,235 240,240,240
`)
const PRESSURE_PALETTE = expandPalette([
	[48, '245,245,245'],
	...PRESSURE_STEPS.map((rgb) => [3, rgb]),
	[21, '245,245,245'],
	[1, '0,0,0'],
])

const WIND_STEPS = parseColors(`
	128,255,255 0,255,255 0,195,255 0,130,255 0,75,130 0,130,0 30,200,0
	75,255,30 130,255,75 200,255,130 255,255,75 255,200,0 255,130,0
	200,75,0 130,30,0 130,10,10 200,20,20 255,40,40 255,75,75 255,130,130
	255,130,255 220,90,220 200,60,200 180,30,180 160,0,160 90,30,90
	120,60,120 150,90,150 180,120,180 210,150,210
`)
const WIND_PALETTE = expandPalette([
	...WIND_STEPS.map((rgb) => [5, rgb]),
	[105, '230,180,230'],
	[1, '0,0,0'],
])

function paletteIndex(index) {
	return Math.max(0, Math.min(255, index))
}

function pressureColor(hpa) {
	return PRESSURE_PALETTE[
		paletteIndex(Math.trunc(((hpa - 915) / 170) * 256) + 1)
	]
}

function windColor(metersPerSecond) {
	return WIND_PALETTE[
		paletteIndex(Math.trunc((Math.abs(metersPerSecond) / 54) * 256))
	]
}

// ---------- colors and geometry ----------

const colors = {
	page: '#FFFBF0',
	day: '#FFFFFF',
	night: '#E0E0E0',
	skyDay: '#87CEFA',
	skyNight: '#82BEE6',
	navy: '#000080',
	air: '#FF0000',
	airBand: '#FADCDC',
	chill: '#0000FF',
	chillBand: '#B9DCFF',
	dew: '#6A5ACD',
	ground: '#A52A2A',
	humidity: '#D2581E',
	// [average (bar), max (thin line)]
	rain: ['#00A500', '#1F6E1F'],
	snow: ['#1932BE', '#0F2382'],
	mixed: ['#B414B4', '#6E0F6E'],
	overflow: '#D21E1E',
	storm: ['#F7E39C', '#D9AD7C', '#A32732'],
	stormEdge: '#231000',
	grid: '#222222',
	gust: '#B41E1E',
	windLine: '#111199',
	visibility: '#FF9600',
	visibilityText: '#D98E00',
	cloudTop: '#A52A2A',
	cloudBase: ['#FAFFFF', '#C8C8C8', '#969696', '#5A5A5A', '#000000'],
	cloudHigh: '#FFFFFF',
	cloudMedium: '#969696',
	cloudLow: '#5A5A5A',
	cloudVeryLow: '#3C3C3C',
	fog: '#FFB400',
}

// [top, bottom] of each panel in pixels
const PANELS = {
	temperature: [57, 135],
	precipitation: [144, 221],
	pressure: [230, 308],
	wind: [317, 395],
	windDirection: [401, 431],
	cloudBase: [438, 516],
	cloudCover: [525, 603],
}
const DAY_NIGHT_STRIP = [29, 630]
const CHART_HEIGHT = 660
const CHART_LEFT = 63
// original: 415 px per 59 h
const PX_PER_HOUR = 415 / 59
const RIGHT_MARGIN = 62
const LEGEND_WIDTH = 280

const WEEKDAYS = ['nie', 'pon', 'wto', 'śro', 'czw', 'pią', 'sob']

function pad2(number) {
	return String(number).padStart(2, '0')
}

function font(px, bold = false) {
	return `${bold ? 'bold ' : ''}${px}px ${FONT_FAMILY}`
}

// ---------- data ----------

// the API returns missing values as huge negative numbers (e.g. -327276480)
function cleanValue(value) {
	if (value == null || !Number.isFinite(value) || value < -1e6) return null
	return value
}

export function normalizeApi(json) {
	const fields = json.data || json
	const keys = Object.keys(fields).filter((key) =>
		Array.isArray(fields[key]?.data),
	)
	if (!keys.length) throw new Error('Brak danych w odpowiedzi API')

	const reference = fields.airtmp_point || fields[keys[0]]
	const series = Object.fromEntries(
		keys.map((key) => [key, fields[key].data.map(cleanValue)]),
	)
	return {
		t0: Number(reference.first_timestamp) * 1000,
		dt: (reference.interval || 3600) * 1000,
		n: Math.max(...keys.map((key) => series[key].length)),
		s: series,
		point: reference.point || {},
		fstart: Date.parse(json.fstart || reference.fstart),
	}
}

// Wind chill (JAG/TI formula).
function windChill(temperature, metersPerSecond) {
	const kmh = metersPerSecond * 3.6
	if (temperature == null || metersPerSecond == null || kmh < 4.8) {
		return temperature
	}
	const power = Math.pow(kmh, 0.16)
	return (
		13.12 + 0.6215 * temperature - 11.37 * power + 0.3965 * temperature * power
	)
}

// Above 10°C the new API returns the air temperature instead of the wind chill,
// while the old meteogram computed wind chill there too — we reproduce that.
const CHILL_AIR_PAIRS = [
	['windChill', 'air'],
	['windChillMax', 'airMax'],
	['windChillMin', 'airMin'],
]

function fixWindChill(series) {
	for (let i = 0; i < series.air.length; i++) {
		for (const [chillKey, airKey] of CHILL_AIR_PAIRS) {
			const chill = series[chillKey][i]
			const air = series[airKey][i]
			if (chill == null || air == null || air <= 10) continue
			if (Math.abs(chill - air) >= 0.01) continue
			series[chillKey][i] = windChill(air, series.windSpeed[i])
		}

		const chill = series.windChill[i]
		if (chill == null) continue
		if (series.windChillMin[i] != null) {
			series.windChillMin[i] = Math.min(series.windChillMin[i], chill)
		}
		if (series.windChillMax[i] != null) {
			series.windChillMax[i] = Math.max(series.windChillMax[i], chill)
		}
	}
	return series
}

function seriesFromModel(model) {
	const get = (key) =>
		model.s[key] || Array.from({ length: model.n }, () => null)
	const positive = (key) =>
		get(key).map((value) => (value != null && value > 0 ? value : null))
	const pascalToHpa = (value) => (value == null ? null : value / 100)

	return {
		air: get('airtmp_point'),
		airMin: get('airtmp_min'),
		airMax: get('airtmp_max'),
		windChill: get('wchill_point'),
		windChillMin: get('wchill_min'),
		windChillMax: get('wchill_max'),
		dewPoint: get('dwptmp_point'),
		groundMin: get('grdtmp_min'),
		groundMax: get('grdtmp_max'),
		precipitationAverage: get('pcpttl_aver'),
		precipitationMax: get('pcpttl_max'),
		precipitationType: get('pcpttl_type_max'),
		storm: get('storm_max'),
		flashes: get('flash_max'),
		humidity: get('realhum_aver'),
		seaLevelPressure: get('slpres_point').map(pascalToHpa),
		terrainPressure: get('trpres_point').map(pascalToHpa),
		windSpeed: get('wind10_sd_true_prev_point'),
		windDirection: get('wind10_dr_deg_true_prev_point'),
		gust: get('wind_gust_max'),
		visibility: get('visibl_min').map((value) =>
			value != null && value > 0 ? value / 1000 : null,
		),
		cloudBase: [
			positive('cldbse01'),
			positive('cldbse25'),
			positive('cldbse45'),
			positive('cldbse65'),
			positive('cldbse79'),
		],
		cloudTop: positive('cldtop'),
		cloudHigh: get('cldhigh_aver'),
		cloudMedium: get('cldmed_aver'),
		cloudLow: get('cldlow_aver'),
		cloudVeryLow: get('cldvlow_aver'),
		fog: get('fog_max'),
	}
}

// ---------- time and sun ----------

export function solarAltitude(ms, lat, lon) {
	const days = ms / DAY_MS + 2440587.5 - 2451545.0
	const meanAnomaly = (357.529 + 0.98560028 * days) * DEG_TO_RAD
	const meanLongitude = 280.459 + 0.98564736 * days
	const eclipticLongitude =
		(meanLongitude +
			1.915 * Math.sin(meanAnomaly) +
			0.02 * Math.sin(2 * meanAnomaly)) *
		DEG_TO_RAD
	const obliquity = (23.439 - 0.00000036 * days) * DEG_TO_RAD
	const rightAscension = Math.atan2(
		Math.cos(obliquity) * Math.sin(eclipticLongitude),
		Math.cos(eclipticLongitude),
	)
	const declination = Math.asin(
		Math.sin(obliquity) * Math.sin(eclipticLongitude),
	)
	const siderealHours =
		(((18.697374558 + 24.06570982441908 * days) % 24) + 24) % 24
	const hourAngle = (siderealHours * 15 + lon) * DEG_TO_RAD - rightAscension
	const altitude = Math.asin(
		Math.sin(lat * DEG_TO_RAD) * Math.sin(declination) +
			Math.cos(lat * DEG_TO_RAD) * Math.cos(declination) * Math.cos(hourAngle),
	)
	return altitude / DEG_TO_RAD
}

function isNight(ms, lat, lon) {
	return solarAltitude(ms, lat, lon) < -0.833
}

const dateFormatters = new Map()

function getDateFormatter(timeZone) {
	if (!dateFormatters.has(timeZone)) {
		dateFormatters.set(
			timeZone,
			new Intl.DateTimeFormat('en-GB', {
				timeZone,
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				hourCycle: 'h23',
			}),
		)
	}
	return dateFormatters.get(timeZone)
}

function timeZoneAbbreviation(offsetMinutes) {
	if (offsetMinutes === 60) return 'CET'
	if (offsetMinutes === 120) return 'CEST'
	return `UTC${offsetMinutes >= 0 ? '+' : ''}${offsetMinutes / 60}`
}

export function localParts(ms, timeZone = DEFAULT_TIME_ZONE) {
	const parts = Object.fromEntries(
		getDateFormatter(timeZone)
			.formatToParts(new Date(ms))
			.map(({ type, value }) => [type, value]),
	)
	const year = Number(parts.year)
	const month = Number(parts.month)
	const day = Number(parts.day)
	const hour = Number(parts.hour) % 24
	const minute = Number(parts.minute)
	const offsetMinutes = Math.round(
		(Date.UTC(year, month - 1, day, hour, minute) -
			Math.floor(ms / 60_000) * 60_000) /
			60_000,
	)
	return {
		year,
		month,
		day,
		hour,
		minute,
		weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
		offsetMinutes,
		abbreviation: timeZoneAbbreviation(offsetMinutes),
	}
}

// sunrise/sunset for the local day containing ms
function sunTimes(ms, lat, lon, timeZone) {
	const { year, month, day, offsetMinutes } = localParts(ms, timeZone)
	const dayStart = Date.UTC(year, month - 1, day) - offsetMinutes * 60_000
	let sunrise = null
	let sunset = null
	let wasNight = isNight(dayStart, lat, lon)
	for (
		let time = dayStart + 60_000;
		time <= dayStart + DAY_MS;
		time += 60_000
	) {
		const night = isNight(time, lat, lon)
		if (wasNight && !night && sunrise == null) sunrise = time
		if (!wasNight && night && sunset == null) sunset = time
		wasNight = night
	}
	return { sunrise, sunset }
}

// ---------- drawing helpers ----------

function createScale([top, bottom], { min, max }) {
	return {
		top,
		bottom,
		min,
		max,
		y: (value) => bottom - ((value - min) / (max - min)) * (bottom - top),
	}
}

function toYs(values, toY) {
	return values.map((value) => (value == null ? null : toY(value)))
}

function withClip(ctx, { left, top, right, bottom }, draw) {
	ctx.save()
	ctx.beginPath()
	ctx.rect(left, top, right - left, bottom - top)
	ctx.clip()
	draw()
	ctx.restore()
}

function drawPolyline(ctx, xs, ys, color, lineWidth) {
	ctx.beginPath()
	let penDown = false
	for (let i = 0; i < xs.length; i++) {
		if (ys[i] == null || Number.isNaN(ys[i])) {
			penDown = false
			continue
		}
		if (penDown) {
			ctx.lineTo(xs[i], ys[i])
		} else {
			ctx.moveTo(xs[i], ys[i])
			penDown = true
		}
	}
	ctx.strokeStyle = color
	ctx.lineWidth = lineWidth
	ctx.lineJoin = 'round'
	ctx.lineCap = 'round'
	ctx.stroke()
}

// area between two series (skips gaps)
function drawBand(ctx, xs, lows, highs, color) {
	const hasBoth = (i) => lows[i] != null && highs[i] != null
	let start = 0
	while (start < xs.length) {
		while (start < xs.length && !hasBoth(start)) start++
		let end = start
		while (end < xs.length && hasBoth(end)) end++
		if (end > start) {
			ctx.beginPath()
			ctx.moveTo(xs[start], highs[start])
			for (let i = start + 1; i < end; i++) ctx.lineTo(xs[i], highs[i])
			for (let i = end - 1; i >= start; i--) ctx.lineTo(xs[i], lows[i])
			ctx.closePath()
			ctx.fillStyle = color
			ctx.fill()
		}
		start = end
	}
}

function drawAreaFromBase(ctx, xs, ys, baseY, color) {
	drawBand(
		ctx,
		xs,
		xs.map(() => baseY),
		ys,
		color,
	)
}

function drawDot(ctx, { x, y, radius, fill, stroke, lineWidth = 1 }) {
	ctx.beginPath()
	ctx.arc(x, y, radius, 0, Math.PI * 2)
	ctx.fillStyle = fill
	ctx.fill()
	if (!stroke) return
	ctx.strokeStyle = stroke
	ctx.lineWidth = lineWidth
	ctx.stroke()
}

function drawText(
	ctx,
	content,
	x,
	y,
	{
		color = '#000',
		align = 'left',
		size = 12,
		bold = false,
		baseline = 'alphabetic',
	} = {},
) {
	ctx.font = font(size, bold)
	ctx.fillStyle = color
	ctx.textAlign = align
	ctx.textBaseline = baseline
	ctx.fillText(content, x, y)
}

function drawVerticalText(ctx, content, x, centerY, color, size = 12) {
	ctx.save()
	ctx.translate(x, centerY)
	ctx.rotate(-Math.PI / 2)
	ctx.font = font(size)
	ctx.fillStyle = color
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.fillText(content, 0, 0)
	ctx.restore()
}

function fitFontSize(ctx, content, maxWidth, size = 12, minSize = 9) {
	let fitted = size
	ctx.font = font(fitted)
	while (fitted > minSize && ctx.measureText(content).width > maxWidth) {
		fitted -= 0.5
		ctx.font = font(fitted)
	}
	return fitted
}

// linear projection onto a non-linear scale (as on meteo.pl); returns a 0..1 fraction
function projectPiecewise(value, labels, cap) {
	if (value == null) return null
	const clamped = Math.max(0, Math.min(value, cap))
	const step = 1 / (labels.length - 1)
	let segment = 0
	while (segment < labels.length - 2 && clamped > labels[segment + 1]) {
		segment++
	}
	const fraction =
		segment * step +
		((clamped - labels[segment]) / (labels[segment + 1] - labels[segment])) *
			step
	return fraction > 0 ? fraction : null
}

function niceRange(min, max, padding, steps) {
	const span = max - min + 2 * padding
	const step = steps.find((candidate) => span / candidate <= 5) ?? steps.at(-1)
	return {
		min: Math.floor((min - padding) / step) * step,
		max: Math.ceil((max + padding) / step) * step,
		step,
	}
}

function finiteValues(arrays) {
	return arrays
		.flat()
		.filter((value) => value != null && Number.isFinite(value))
}

function ticksBetween(min, max, step) {
	const ticks = []
	for (
		let value = Math.ceil(min / step - 1e-9) * step;
		value <= max + 1e-9;
		value += step
	) {
		ticks.push(Math.round(value * 1000) / 1000)
	}
	return ticks
}

// ---------- time axis geometry ----------

function createLayout({ n, left, pxPerStep, t0, dt }) {
	const xAt = (index) => left + index * pxPerStep
	return {
		n,
		left,
		right: left + (n - 1) * pxPerStep,
		pxPerStep,
		t0,
		dt,
		xAt,
		xAtTime: (time) => left + ((time - t0) / dt) * pxPerStep,
		xs: Array.from({ length: n }, (_, index) => xAt(index)),
	}
}

function findNightSegments(layout, lat, lon) {
	const segments = []
	let start = null
	for (let x = layout.left; x <= layout.right; x += 1) {
		const time =
			layout.t0 + ((x - layout.left + 0.5) / layout.pxPerStep) * layout.dt
		const night = isNight(time, lat, lon)
		if (night && start == null) start = x
		if (!night && start != null) {
			segments.push([start, x])
			start = null
		}
	}
	if (start != null) segments.push([start, layout.right])
	return segments
}

// ---------- panel drawing ----------

function drawDayNightStrip(ctx, layout, nightSegments) {
	const [top, bottom] = DAY_NIGHT_STRIP
	ctx.fillStyle = colors.day
	ctx.fillRect(layout.left, top, layout.right - layout.left, bottom - top)
	ctx.fillStyle = colors.night
	for (const [start, end] of nightSegments) {
		ctx.fillRect(start, top, end - start, bottom - top)
	}
}

function drawSky(ctx, layout, nightSegments, [top, bottom]) {
	ctx.fillStyle = colors.skyDay
	ctx.fillRect(layout.left, top, layout.right - layout.left, bottom - top)
	ctx.fillStyle = colors.skyNight
	for (const [start, end] of nightSegments) {
		ctx.fillRect(start, top, end - start, bottom - top)
	}
}

function drawGrid(ctx, layout, [top, bottom], ys, xs) {
	ctx.save()
	ctx.strokeStyle = colors.grid
	ctx.lineWidth = 1
	ctx.setLineDash([2, 2])
	ctx.beginPath()
	for (const x of xs) {
		const crispX = Math.round(x) + 0.5
		ctx.moveTo(crispX, top)
		ctx.lineTo(crispX, bottom)
	}
	for (const y of ys) {
		const crispY = Math.round(y) + 0.5
		if (crispY <= top + 1 || crispY >= bottom - 1) continue
		ctx.moveTo(layout.left, crispY)
		ctx.lineTo(layout.right, crispY)
	}
	ctx.stroke()
	ctx.restore()
}

function drawFrame(ctx, layout, [top, bottom]) {
	ctx.strokeStyle = '#000'
	ctx.lineWidth = 1
	ctx.setLineDash([])
	ctx.strokeRect(
		Math.round(layout.left) + 0.5,
		top + 0.5,
		Math.round(layout.right - layout.left),
		bottom - top,
	)
}

function drawTickLabels(
	ctx,
	layout,
	scale,
	ticks,
	format,
	side,
	color = '#000',
) {
	const x = side === 'left' ? layout.left - 6 : layout.right + 6
	const align = side === 'left' ? 'right' : 'left'
	for (const value of ticks) {
		drawText(ctx, format(value), x, scale.y(value), {
			align,
			baseline: 'middle',
			color,
		})
	}
}

function drawTemperature(ctx, layout, series, scale) {
	const { xs } = layout
	drawBand(
		ctx,
		xs,
		toYs(series.airMin, scale.y),
		toYs(series.airMax, scale.y),
		colors.airBand,
	)
	drawBand(
		ctx,
		xs,
		toYs(series.windChillMin, scale.y),
		toYs(series.windChillMax, scale.y),
		colors.chillBand,
	)

	ctx.strokeStyle = colors.ground
	ctx.lineWidth = 1
	ctx.beginPath()
	for (let i = 0; i < layout.n; i++) {
		if (series.groundMin[i] == null || series.groundMax[i] == null) continue
		const x = Math.round(xs[i]) + 0.5
		ctx.moveTo(x, scale.y(series.groundMax[i]))
		ctx.lineTo(x, scale.y(series.groundMin[i]))
	}
	ctx.stroke()

	for (let i = 0; i < layout.n; i++) {
		if (series.dewPoint[i] == null) continue
		drawDot(ctx, {
			x: xs[i],
			y: scale.y(series.dewPoint[i]),
			radius: 1.7,
			fill: colors.dew,
		})
	}
	drawPolyline(ctx, xs, toYs(series.windChill, scale.y), colors.chill, 2)
	drawPolyline(ctx, xs, toYs(series.air, scale.y), colors.air, 2)
}

function precipitationColors(type) {
	if (type === 2) return colors.snow
	if (type === 3) return colors.mixed
	return colors.rain
}

function stormColor(flashes) {
	if (flashes >= 30) return colors.storm[2]
	if (flashes >= 10) return colors.storm[1]
	return colors.storm[0]
}

function drawPrecipitation(ctx, layout, series, scale, humidityScale) {
	const barWidth = layout.pxPerStep
	for (let i = 0; i < layout.n; i++) {
		const average = series.precipitationAverage[i] || 0
		const max = series.precipitationMax[i] || 0
		if (average <= 0 && max <= 0) continue

		const [averageColor, maxColor] = precipitationColors(
			series.precipitationType[i],
		)
		const right = layout.xs[i]
		const left = right - barWidth
		const averageY = Math.round(scale.y(Math.min(average, scale.max)))
		if (average > 0 && averageY < scale.bottom) {
			const barLeft = Math.round(left)
			ctx.fillStyle = averageColor
			ctx.fillRect(
				barLeft,
				averageY,
				Math.round(right) - barLeft,
				scale.bottom - averageY,
			)
		}
		if (max <= 0) continue

		const middleX = Math.round(left + barWidth / 2) + 0.5
		ctx.strokeStyle = maxColor
		ctx.lineWidth = 1
		ctx.beginPath()
		ctx.moveTo(middleX, scale.bottom)
		ctx.lineTo(
			middleX,
			Math.min(scale.bottom - 1, Math.round(scale.y(Math.min(max, scale.max)))),
		)
		ctx.stroke()
		if (max > scale.max) {
			ctx.fillStyle = colors.overflow
			ctx.fillRect(Math.round(left + barWidth / 2) - 1, scale.top + 2, 3, 3)
		}
	}

	drawPolyline(
		ctx,
		layout.xs,
		toYs(series.humidity, (value) =>
			humidityScale.y(Math.max(humidityScale.min, value)),
		),
		colors.humidity,
		2,
	)

	const stormY = scale.bottom - 0.62 * (scale.bottom - scale.top)
	for (let i = 0; i < layout.n; i++) {
		if (!(series.storm[i] > 0)) continue
		drawDot(ctx, {
			x: layout.xs[i] - barWidth / 2,
			y: stormY,
			radius: 2.5,
			fill: stormColor(series.flashes[i] || 0),
			stroke: colors.stormEdge,
		})
	}
}

// fill under the curve, each segment colored from the palette by its average value
function drawColoredArea(ctx, layout, values, scale, colorFor) {
	for (let i = 0; i < layout.n - 1; i++) {
		const from = values[i]
		const to = values[i + 1]
		if (from == null || to == null) continue
		const x0 = layout.xs[i]
		const x1 = layout.xs[i + 1]
		ctx.beginPath()
		ctx.moveTo(x0, scale.bottom)
		ctx.lineTo(x0, scale.y(from))
		ctx.lineTo(x1, scale.y(to))
		ctx.lineTo(x1 + 0.6, scale.y(to))
		ctx.lineTo(x1 + 0.6, scale.bottom)
		ctx.closePath()
		ctx.fillStyle = colorFor((from + to) / 2)
		ctx.fill()
	}
}

function drawPressure(ctx, layout, series, scale) {
	const pressure = series.seaLevelPressure
	drawColoredArea(ctx, layout, pressure, scale, pressureColor)
	drawPolyline(ctx, layout.xs, toYs(pressure, scale.y), '#000', 2)
}

function drawWind(ctx, layout, series, scale) {
	const speed = series.windSpeed
	drawColoredArea(ctx, layout, speed, scale, windColor)
	drawPolyline(ctx, layout.xs, toYs(speed, scale.y), colors.windLine, 2)

	ctx.strokeStyle = colors.gust
	ctx.lineWidth = 1
	ctx.beginPath()
	for (let i = 0; i < layout.n; i++) {
		const gust = series.gust[i]
		if (gust == null || gust > scale.max) continue
		const y = Math.round(scale.y(gust)) + 0.5
		ctx.moveTo(layout.xs[i] - layout.pxPerStep, y)
		ctx.lineTo(layout.xs[i], y)
	}
	ctx.stroke()

	for (let i = 0; i < layout.n; i++) {
		const gust = series.gust[i]
		if (gust == null || gust <= scale.max) continue
		const x = layout.xs[i] - layout.pxPerStep / 2
		ctx.beginPath()
		ctx.moveTo(x - 3, scale.top + 1)
		ctx.lineTo(x + 3, scale.top + 1)
		ctx.lineTo(x, scale.top + 6)
		ctx.closePath()
		ctx.fillStyle = colors.overflow
		ctx.fill()
	}
}

function drawArrow(ctx, { x, y, towardDegrees, length, color }) {
	const angle = towardDegrees * DEG_TO_RAD
	const dx = Math.sin(angle)
	const dy = -Math.cos(angle)
	const headX = x + (dx * length) / 2
	const headY = y + (dy * length) / 2
	const tailX = x - (dx * length) / 2
	const tailY = y - (dy * length) / 2
	ctx.strokeStyle = color
	ctx.fillStyle = color
	ctx.lineWidth = 1.2
	ctx.beginPath()
	ctx.moveTo(tailX, tailY)
	ctx.lineTo(headX - dx * 3, headY - dy * 3)
	ctx.stroke()

	const headLength = 5
	const headHalfWidth = 2.6
	ctx.beginPath()
	ctx.moveTo(headX, headY)
	ctx.lineTo(
		headX - dx * headLength - dy * headHalfWidth,
		headY - dy * headLength + dx * headHalfWidth,
	)
	ctx.lineTo(
		headX - dx * headLength + dy * headHalfWidth,
		headY - dy * headLength - dx * headHalfWidth,
	)
	ctx.closePath()
	ctx.fill()
}

function drawWindDirection(ctx, layout, series, [top, bottom]) {
	const centerY = (top + bottom) / 2
	for (let i = 0; i < layout.n; i++) {
		if (series.windDirection[i] == null) continue
		// the API gives where the wind blows from, the arrow shows where it blows to
		drawArrow(ctx, {
			x: layout.xs[i],
			y: centerY,
			towardDegrees: series.windDirection[i] + 180,
			length: 14,
			color: colors.windLine,
		})
	}
}

const CLOUD_BASE_LABELS = [0, 0.5, 2, 7, 15]
const VISIBILITY_LABELS = [0, 1, 5, 20, 100]

function drawCloudBase(ctx, layout, series, [top, bottom]) {
	const fractionToY = (fraction) =>
		fraction == null ? null : bottom - fraction * (bottom - top)
	drawPolyline(
		ctx,
		layout.xs,
		series.visibility.map((value) =>
			fractionToY(projectPiecewise(value, VISIBILITY_LABELS, 90)),
		),
		colors.visibility,
		2,
	)

	const drawHeights = (heights, fill, stroke) => {
		for (let i = 0; i < layout.n; i++) {
			const fraction = projectPiecewise(heights[i], CLOUD_BASE_LABELS, 14)
			if (fraction == null) continue
			drawDot(ctx, {
				x: layout.xs[i],
				y: fractionToY(fraction),
				radius: 2.8,
				fill,
				stroke,
				lineWidth: 0.8,
			})
		}
	}
	drawHeights(series.cloudTop, colors.cloudTop)
	series.cloudBase.forEach((heights, index) => {
		const stroke = index === 0 ? '#969696' : undefined
		drawHeights(heights, colors.cloudBase[index], stroke)
	})
}

function drawCloudCover(ctx, layout, series, panel) {
	const scale = createScale(panel, { min: 0, max: 8 })
	const { xs } = layout
	const octasY = (values) =>
		toYs(values, (value) => scale.y(Math.max(0, Math.min(1, value)) * 8))
	drawAreaFromBase(
		ctx,
		xs,
		octasY(series.cloudHigh),
		scale.bottom,
		colors.cloudHigh,
	)
	drawAreaFromBase(
		ctx,
		xs,
		octasY(series.cloudMedium),
		scale.bottom,
		colors.cloudMedium,
	)
	drawAreaFromBase(
		ctx,
		xs,
		octasY(series.cloudLow),
		scale.bottom,
		colors.cloudLow,
	)
	drawAreaFromBase(
		ctx,
		xs,
		octasY(series.cloudVeryLow),
		scale.bottom,
		colors.cloudVeryLow,
	)
	drawPolyline(ctx, xs, octasY(series.cloudMedium), colors.cloudMedium, 1.5)
	drawPolyline(ctx, xs, octasY(series.cloudHigh), colors.cloudHigh, 1.5)

	for (let i = 0; i < layout.n; i++) {
		const fog = series.fog[i]
		if (!(fog > 0)) continue
		const height = Math.max(1, Math.min(1, fog) * (scale.bottom - scale.top))
		ctx.fillStyle = colors.fog
		ctx.fillRect(xs[i] - 1.5, scale.bottom - height, 3, height)
	}
}

function drawCompass(ctx, x, centerY) {
	const options = { align: 'center', size: 11, color: colors.navy }
	drawText(ctx, 'N', x, centerY - 5, options)
	drawText(ctx, 'S', x, centerY + 9, options)
	drawText(ctx, 'W', x - 8, centerY + 2, options)
	drawText(ctx, 'E', x + 7, centerY + 2, options)
}

// ---------- scales ----------

// [largest value, scale maximum, step]
const PRECIPITATION_RANGES = [
	[5, 5, 1],
	[10, 10, 2],
	[20, 20, 4],
	[Infinity, 30, 6],
]
const WIND_RANGES = [
	[5, 5, 1],
	[10, 10, 2],
	[15, 15, 5],
	[20, 20, 5],
	[25, 25, 5],
	[30, 30, 10],
	[40, 40, 10],
	[Infinity, 50, 10],
]

function rangeFromZero(value, ranges) {
	const [, max, step] = ranges.find(([upTo]) => value <= upTo) ?? ranges.at(-1)
	return { min: 0, max, step }
}

function temperatureStep(span) {
	if (span <= 22) return 5
	if (span <= 45) return 10
	return 20
}

function maxOrZero(values) {
	return values.length ? Math.max(...values) : 0
}

function computeRanges(series) {
	const temperatures = finiteValues([
		series.air,
		series.airMin,
		series.airMax,
		series.windChill,
		series.windChillMin,
		series.windChillMax,
		series.dewPoint,
		series.groundMin,
		series.groundMax,
	])
	const minTemperature = Math.min(...temperatures)
	const maxTemperature = Math.max(...temperatures)
	const temperature = {
		min: minTemperature - 1,
		max: maxTemperature + 1,
		step: temperatureStep(maxTemperature - minTemperature + 2),
	}

	const maxPrecipitation = Math.max(
		0,
		...finiteValues([series.precipitationMax, series.precipitationAverage]),
	)
	const precipitation = rangeFromZero(maxPrecipitation, PRECIPITATION_RANGES)

	const pressures = finiteValues([series.seaLevelPressure])
	const pressure = pressures.length
		? niceRange(
				Math.min(...pressures),
				Math.max(...pressures),
				1,
				[2, 5, 10, 20],
			)
		: { min: 1000, max: 1020, step: 5 }

	// gusts may stretch the scale to at most 4× the wind speed
	const maxSpeed = maxOrZero(finiteValues([series.windSpeed]))
	const maxGust = maxOrZero(finiteValues([series.gust]))
	const windTop = Math.round(
		Math.min(Math.max(maxSpeed, maxGust), 4 * maxSpeed),
	)
	const wind = rangeFromZero(windTop, WIND_RANGES)

	return { temperature, precipitation, pressure, wind }
}

// ---------- shared drawing of the full panel set ----------

const FRACTION_TICKS = [0, 0.25, 0.5, 0.75, 1]
const OCTA_TICKS = [0, 2, 4, 6, 8]

function formatInteger(value) {
	return String(Math.round(value))
}

function drawPanels(
	ctx,
	{ layout, series, ranges, nightSegments, gridXs, pressureRightInHpa = false },
) {
	drawDayNightStrip(ctx, layout, nightSegments)
	drawSky(ctx, layout, nightSegments, PANELS.cloudBase)
	drawSky(ctx, layout, nightSegments, PANELS.cloudCover)

	const inPanel = ([top, bottom], draw) =>
		withClip(
			ctx,
			{ left: layout.left, top, right: layout.right + 1, bottom: bottom + 1 },
			draw,
		)
	const scaleFor = (panel, range) => {
		const scale = createScale(panel, range)
		const ticks = ticksBetween(range.min, range.max, range.step)
		return { scale, ticks, ys: ticks.map(scale.y) }
	}

	const temperature = scaleFor(PANELS.temperature, ranges.temperature)
	if (ranges.temperature.min < 0) {
		// frost: sky-colored background below 0°C
		const [top, bottom] = PANELS.temperature
		const zeroY = Math.max(top, Math.min(bottom, temperature.scale.y(0)))
		drawSky(ctx, layout, nightSegments, [zeroY, bottom])
	}
	inPanel(PANELS.temperature, () => {
		drawTemperature(ctx, layout, series, temperature.scale)
		drawGrid(ctx, layout, PANELS.temperature, temperature.ys, gridXs)
	})

	const precipitation = scaleFor(PANELS.precipitation, ranges.precipitation)
	const humidityScale = createScale(PANELS.precipitation, { min: 50, max: 100 })
	inPanel(PANELS.precipitation, () => {
		drawPrecipitation(ctx, layout, series, precipitation.scale, humidityScale)
		drawGrid(ctx, layout, PANELS.precipitation, precipitation.ys, gridXs)
	})

	const pressure = scaleFor(PANELS.pressure, ranges.pressure)
	inPanel(PANELS.pressure, () => {
		drawPressure(ctx, layout, series, pressure.scale)
		drawGrid(ctx, layout, PANELS.pressure, pressure.ys, gridXs)
	})

	const wind = scaleFor(PANELS.wind, ranges.wind)
	inPanel(PANELS.wind, () => {
		drawWind(ctx, layout, series, wind.scale)
		drawGrid(ctx, layout, PANELS.wind, wind.ys, gridXs)
	})

	inPanel(PANELS.windDirection, () => {
		drawGrid(ctx, layout, PANELS.windDirection, [], gridXs)
		drawWindDirection(ctx, layout, series, PANELS.windDirection)
	})

	const cloudBaseScale = createScale(PANELS.cloudBase, { min: 0, max: 1 })
	inPanel(PANELS.cloudBase, () => {
		drawCloudBase(ctx, layout, series, PANELS.cloudBase)
		drawGrid(
			ctx,
			layout,
			PANELS.cloudBase,
			FRACTION_TICKS.map(cloudBaseScale.y),
			gridXs,
		)
	})

	const cloudCoverScale = createScale(PANELS.cloudCover, { min: 0, max: 8 })
	inPanel(PANELS.cloudCover, () => {
		drawCloudCover(ctx, layout, series, PANELS.cloudCover)
		drawGrid(
			ctx,
			layout,
			PANELS.cloudCover,
			OCTA_TICKS.map(cloudCoverScale.y),
			gridXs,
		)
	})

	for (const panel of Object.values(PANELS)) drawFrame(ctx, layout, panel)

	// axis labels
	const labels = (axis, format, side, color) =>
		drawTickLabels(ctx, layout, axis.scale, axis.ticks, format, side, color)

	labels(temperature, formatInteger, 'left')
	labels(temperature, formatInteger, 'right')

	const formatPrecipitation =
		ranges.precipitation.step < 1 ? (value) => value.toFixed(1) : formatInteger
	const { min: precipitationMin, max: precipitationMax } = ranges.precipitation
	const precipitationToHumidity = (value) =>
		formatInteger(
			50 +
				((value - precipitationMin) / (precipitationMax - precipitationMin)) *
					50,
		)
	labels(precipitation, formatPrecipitation, 'left')
	labels(precipitation, precipitationToHumidity, 'right', colors.humidity)

	const hpaToMmHg = (value) => formatInteger(value * 0.750062)
	labels(pressure, formatInteger, 'left')
	labels(pressure, pressureRightInHpa ? formatInteger : hpaToMmHg, 'right')

	labels(wind, formatInteger, 'left')
	labels(wind, (value) => formatInteger(value * 3.6), 'right')

	const cloudBaseAxis = { scale: cloudBaseScale, ticks: FRACTION_TICKS }
	const labelAt = (list) => (fraction) => list[Math.round(fraction * 4)]
	labels(
		cloudBaseAxis,
		(fraction) => labelAt(CLOUD_BASE_LABELS)(fraction).toFixed(1),
		'left',
	)
	labels(
		cloudBaseAxis,
		(fraction) => String(labelAt(VISIBILITY_LABELS)(fraction)),
		'right',
		colors.visibilityText,
	)

	labels({ scale: cloudCoverScale, ticks: OCTA_TICKS }, formatInteger, 'left')
	labels(
		{
			scale: createScale(PANELS.cloudCover, { min: 0, max: 1 }),
			ticks: FRACTION_TICKS,
		},
		String,
		'right',
		colors.visibilityText,
	)
}

// ---------- main meteogram ----------

function chartSize(model) {
	return {
		width: Math.round(CHART_LEFT + (model.n - 1) * PX_PER_HOUR + RIGHT_MARGIN),
		height: CHART_HEIGHT,
	}
}

export function measure(model, { legend } = {}) {
	const { width, height } = chartSize(model)
	return { width: width + (legend === false ? 0 : LEGEND_WIDTH), height }
}

function formatDms(value, positive, negative) {
	const absolute = Math.abs(value)
	const degrees = Math.floor(absolute)
	const minutesFloat = (absolute - degrees) * 60
	const minutes = Math.floor(minutesFloat)
	const seconds = Math.round((minutesFloat - minutes) * 60)
	return `${degrees}°${minutes}'${seconds}"${value >= 0 ? positive : negative}`
}

// terrain height from the barometric formula (median over all hours)
export function terrainHeight(series) {
	const heights = []
	for (let i = 0; i < series.seaLevelPressure.length; i++) {
		const seaLevel = series.seaLevelPressure[i]
		const terrain = series.terrainPressure[i]
		if (!seaLevel || !terrain) continue
		heights.push(44330 * (1 - Math.pow(terrain / seaLevel, 0.1903)))
	}
	if (!heights.length) return null
	heights.sort((a, b) => a - b)
	return Math.round(heights[Math.floor(heights.length / 2)])
}

const AXIS_TITLES = [
	['temperature', ['temperatura', '(°C)'], ['(°C)', 'temperatura']],
	['precipitation', ['opad', '(mm/h, kg/m²/h)'], ['(%)', 'wilgotność wzgl.']],
	['pressure', ['ciśnienie', '(hPa)'], ['(mm Hg)', 'ciśnienie']],
	['wind', ['wiatr', '(m/s)'], ['(km/h)', 'wiatr']],
	['cloudBase', ['pion. rozciągł. chm.', '(km)'], ['(km)', 'widzialność']],
	['cloudCover', ['zachmurzenie', '(oktanty)'], ['(frakcja)', 'mgła']],
]

function drawAxisTitles(ctx, width) {
	for (const [
		panelName,
		[leftOuter, leftInner],
		[rightInner, rightOuter],
	] of AXIS_TITLES) {
		const [top, bottom] = PANELS[panelName]
		const centerY = (top + bottom) / 2
		const maxWidth = bottom - top + 14
		const draw = (content, x) =>
			drawVerticalText(
				ctx,
				content,
				x,
				centerY,
				colors.navy,
				fitFontSize(ctx, content, maxWidth),
			)
		draw(leftOuter, 11)
		draw(leftInner, 25)
		draw(rightInner, width - 24)
		draw(rightOuter, width - 8)
	}
	const [top, bottom] = PANELS.windDirection
	const compassY = (top + bottom) / 2 - 2
	drawCompass(ctx, 22, compassY)
	drawCompass(ctx, width - 22, compassY)
}

// time axis: local time on top, UTC at the bottom
function drawTimeAxis(ctx, { layout, model, timeZone, endTime }) {
	drawText(
		ctx,
		localParts(model.t0, timeZone).abbreviation,
		CHART_LEFT - 11,
		54,
		{
			align: 'right',
		},
	)
	drawText(
		ctx,
		localParts(endTime, timeZone).abbreviation,
		layout.right + 12,
		54,
	)
	drawText(ctx, 'UTC', CHART_LEFT - 11, 616, { align: 'right' })
	drawText(ctx, 'UTC', layout.right + 12, 616)

	const firstHour = Math.ceil(model.t0 / HOUR_MS) * HOUR_MS
	for (let time = firstHour; time <= endTime; time += HOUR_MS) {
		const utcHour = new Date(time).getUTCHours()
		if (utcHour % 6 !== 3) continue
		const x = layout.xAtTime(time)
		const center = { align: 'center' }
		drawText(ctx, pad2(localParts(time, timeZone).hour), x, 54, center)
		drawText(ctx, pad2(utcHour), x, 616, center)
	}

	// date above each day, centered on UTC noon and clamped to the chart edges
	const seenDays = new Set()
	const margin = 4 * HOUR_MS
	for (let time = model.t0; time <= endTime + DAY_MS; time += HOUR_MS) {
		const { year, month, day, weekday } = localParts(time, timeZone)
		const key = `${year}-${month}-${day}`
		if (seenDays.has(key)) continue
		seenDays.add(key)

		const noon = Date.UTC(year, month - 1, day, 12)
		if (noon < model.t0 - margin || noon > endTime + margin) continue

		const noonX = layout.xAtTime(noon)
		const drawDate = (content, y) => {
			ctx.font = font(12)
			const halfWidth = ctx.measureText(content).width / 2
			const x = Math.max(
				layout.left + halfWidth,
				Math.min(layout.right - halfWidth, noonX),
			)
			drawText(ctx, content, x, y, { align: 'center' })
		}
		const date = `${pad2(day)}.${pad2(month)}`
		drawDate(`${WEEKDAYS[weekday]}, ${date}`, 41)
		drawDate(date, 629)
	}
}

function drawHeader(ctx, { model, series, width, lat, lon, timeZone }) {
	const navy = { color: colors.navy }
	const navyCentered = { align: 'center', color: colors.navy }

	const { sunrise, sunset } = sunTimes(model.t0, lat, lon, timeZone)
	const formatTime = (ms) => {
		if (ms == null) return '--:--'
		const { hour, minute, abbreviation } = localParts(ms, timeZone)
		return `${pad2(hour)}:${pad2(minute)} ${abbreviation}`
	}
	drawText(ctx, `wschód słońca: ${formatTime(sunrise)}`, 4, 12, navy)
	drawText(ctx, `zachód słońca: ${formatTime(sunset)}`, 4, 25, navy)

	const centerX = width / 2 + 33
	drawText(
		ctx,
		`${formatDms(lon, 'E', 'W')}, ${formatDms(lat, 'N', 'S')}`,
		centerX,
		12,
		navyCentered,
	)
	if (model.point.col != null) {
		drawText(
			ctx,
			`(x=${model.point.col},  y=${model.point.row})`,
			centerX,
			25,
			navyCentered,
		)
	}

	const height = terrainHeight(series)
	const rightX = width - 74
	drawText(ctx, 'wysokość terenu (model)', rightX, 12, navyCentered)
	drawText(
		ctx,
		height == null ? '–' : `≈ ${height} m n.p.m.`,
		rightX,
		25,
		navyCentered,
	)
}

function drawFooter(ctx, width) {
	const options = { color: colors.navy, size: 11 }
	drawText(ctx, 'dane: ICM UW (meteo.pl), model UM 4 km', 18, 652, options)
	drawText(ctx, 'nieoficjalna wizualizacja', width - 15, 652, {
		...options,
		align: 'right',
	})
}

function drawChart(ctx, model, options) {
	const { width } = chartSize(model)
	const series = fixWindChill(seriesFromModel(model))
	const lat = model.point.lat ?? options.lat
	const lon = model.point.lon ?? options.lon
	const timeZone = options.tz || DEFAULT_TIME_ZONE
	const layout = createLayout({
		n: model.n,
		left: CHART_LEFT,
		pxPerStep: PX_PER_HOUR,
		t0: model.t0,
		dt: model.dt,
	})
	const endTime = model.t0 + (model.n - 1) * model.dt

	ctx.fillStyle = colors.page
	ctx.fillRect(0, 0, width, CHART_HEIGHT)

	// vertical grid every 3 h UTC
	const gridXs = []
	const firstHour = Math.ceil(model.t0 / HOUR_MS) * HOUR_MS
	for (let time = firstHour; time <= endTime; time += HOUR_MS) {
		if (new Date(time).getUTCHours() % 3 === 0)
			gridXs.push(layout.xAtTime(time))
	}

	drawPanels(ctx, {
		layout,
		series,
		ranges: computeRanges(series),
		nightSegments: findNightSegments(layout, lat, lon),
		gridXs,
	})
	drawAxisTitles(ctx, width)
	drawTimeAxis(ctx, { layout, model, timeZone, endTime })
	drawHeader(ctx, { model, series, width, lat, lon, timeZone })
	drawFooter(ctx, width)
}

// ---------- legend (static example, as on the old meteo.pl) ----------

const LEGEND_HOURS = 17
const LEGEND_AIR = [
	7, 6.5, 5.5, 4.5, 3.5, 2.5, 2, 1.5, 1, 0.5, 0, -0.5, -1, -2, -3, -1.5, 0,
]
const LEGEND_AIR_SPREAD = [9, 8, 7, 6, 5, 4, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2]

const legendSeries = {
	air: LEGEND_AIR,
	airMax: LEGEND_AIR.map((value, i) => value + LEGEND_AIR_SPREAD[i]),
	airMin: LEGEND_AIR.map((value) => value - 2),
	windChill: LEGEND_AIR.map((value) => value - 3),
	windChillMax: LEGEND_AIR.map((value) => value - 1.5),
	windChillMin: LEGEND_AIR.map((value) => value - 7),
	dewPoint: [
		-1, -1.5, -2, -2.5, -3, -3, -3.5, -4, -4, -4, -4.5, -5, -5, -5.5, -6, -5,
		-4,
	],
	groundMax: [24, 21, 17, 12, 8, 5, 3, 2, 1, 1, 0.5, 0, 0, 0, -1, 1, 3],
	groundMin: [6, 4, 2, 0, -1, -2, -3, -3, -4, -4, -4, -5, -5, -5, -6, -4, -2],
	precipitationAverage: [
		0.95, 1.15, 1.2, 1.0, 0.45, 0.3, 0.05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	],
	precipitationMax: [
		1.5, 2.6, 2.6, 1.4, 0.7, 0.55, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	],
	precipitationType: [1, 1, 1, 2, 1, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	storm: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	flashes: [4, 12, 35, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	humidity: [
		72, 80, 86, 90, 93, 95, 96, 96, 95, 94, 95, 96, 96, 95, 93, 90, 86,
	],
	seaLevelPressure: [
		1015.6, 1015.9, 1016.3, 1016.6, 1016.8, 1016.7, 1016.5, 1016.3, 1016.3,
		1016.3, 1016.2, 1016.1, 1016.0, 1015.8, 1015.6, 1015.3, 1015.0,
	],
	windSpeed: [
		5, 5.6, 5.2, 4.6, 4.1, 3.6, 3.5, 3.8, 4.0, 4.2, 4.6, 4.4, 4.0, 4.2, 4.8,
		5.3, 5.6,
	],
	gust: [
		21, 13.5, 12.5, 11.5, 10.5, 9.5, 9, 8.5, 9, 9.5, 10, 10, 9.5, 10, 11, 12,
		12.5,
	],
	windDirection: Array.from(
		{ length: LEGEND_HOURS },
		(_, i) => 320 + (i % 3) * 4,
	),
	visibility: [4, 6, 8, 10, 12, 14, 12, 10, 8, 7, 6, 7, 8, 7, 6, 6, 7],
	// one row per coverage threshold, null = no cloud base in that hour
	// oxfmt-ignore
	cloudBase: [
		[0.3, 0.3, 0.35, 0.4, 0.35, null, 0.3, 0.25, 0.2, 0.2, 0.25, null, null, 0.2, 0.2, 0.2, 0.2],
		[0.5, 0.45, 0.6, null, 0.45, 0.5, null, 0.4, 0.45, null, 0.6, 0.5, 0.45, null, 0.5, 0.4, null],
		[null, 0.6, null, 0.8, 0.6, null, 0.6, 0.6, null, 0.8, null, 0.9, null, 1.1, 1.0, null, 0.8],
		[2.5, null, 3, null, null, 3.5, 4, null, 5, 4.5, null, 3.5, 3, 2.5, null, 2.5, 3],
		[null, null, null, 6, 6.5, 6, null, 7.5, 8, null, 6.5, 4.5, null, 3.5, 3, null, 2.5],
	],
	cloudTop: [
		8.5, 9.5, 9.5, 11, 11, 11.5, 11.5, 12, 12, 12, 12, 12, 12, 12, 11.5, 11.5,
		11.5,
	],
	cloudHigh: [
		0, 0, 0, 0.1, 0.3, 0.5, 0.65, 0.75, 0.85, 0.95, 0.85, 0.7, 0.55, 0.5, 0.45,
		0.5, 0.55,
	],
	cloudMedium: [
		0.25, 0.3, 0.2, 0.15, 0.1, 0.2, 0.4, 0.55, 0.5, 0.45, 0.35, 0.3, 0.3, 0.35,
		0.3, 0.25, 0.2,
	],
	cloudLow: [
		0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.1, 0.15, 0.2, 0.25, 0.3, 0.3, 0.3, 0.25,
		0.2, 0.2, 0.25,
	],
	cloudVeryLow: [
		0.15, 0.1, 0.08, 0.05, 0.03, 0, 0, 0, 0, 0.03, 0.06, 0.08, 0.1, 0.1, 0.08,
		0.1, 0.12,
	],
	fog: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.12, 0.25, 0.25, 0.25, 0.25],
}

const legendRanges = {
	temperature: { min: -12, max: 32, step: 10 },
	precipitation: { min: 0, max: 2.2, step: 0.5 },
	pressure: { min: 1011.6, max: 1018, step: 2 },
	wind: { min: 0, max: 20, step: 5 },
}

// white text on a sky-colored box (as in the original)
const SKY_BOX = { background: colors.skyDay, foreground: '#FFFFFF' }

// legend labels: text, position (baseline) and an optional point the leader line points to
function legendLabels(layout) {
	const series = legendSeries
	const temperature = createScale(PANELS.temperature, legendRanges.temperature)
	const precipitation = createScale(
		PANELS.precipitation,
		legendRanges.precipitation,
	)
	const humidity = createScale(PANELS.precipitation, { min: 50, max: 100 })
	const pressure = createScale(PANELS.pressure, legendRanges.pressure)
	const wind = createScale(PANELS.wind, legendRanges.wind)
	const cloudCover = createScale(PANELS.cloudCover, { min: 0, max: 8 })
	const [cloudBaseTop, cloudBaseBottom] = PANELS.cloudBase
	const pieceY = (value, labels, cap) =>
		cloudBaseBottom -
		projectPiecewise(value, labels, cap) * (cloudBaseBottom - cloudBaseTop)
	const cloudBaseY = (value) => pieceY(value, CLOUD_BASE_LABELS, 14)
	const visibilityY = (value) => pieceY(value, VISIBILITY_LABELS, 90)
	const x = layout.xAt
	const middle = (i) => x(i) - PX_PER_HOUR / 2

	const stormY =
		precipitation.bottom - 0.62 * (precipitation.bottom - precipitation.top)
	const windDirectionY = (PANELS.windDirection[0] + PANELS.windDirection[1]) / 2

	// [text, x, y, color or SKY_BOX, target [x, y]]
	// oxfmt-ignore
	return [
		['Czas lokalny', 6, 19, '#000'],
		['(CET/CEST)', 6, 31, '#000', [x(4) - 8, 45]],
		['Temperatura gruntu', 6, 47, colors.ground],
		['max/min', 28, 57, colors.ground, [x(2), temperature.y(series.groundMax[2]) + 2]],
		['Temperatura:', 6, 69, '#000'],
		['punkt środkowy', 12, 81, colors.air, [x(1), temperature.y(series.air[1])]],
		['max/min', 28, 91, '#F09A9A', [x(0) + 3, temperature.y(series.airMax[0] - 2)]],
		['odczuwana', 12, 103, colors.chill, [x(1), temperature.y(series.windChill[1])]],
		['max/min', 28, 112, '#7FB4E8', [x(0) + 3, temperature.y(series.windChillMin[0] + 1.5)]],
		['Temp. punktu rosy', 6, 124, colors.dew, [x(4), temperature.y(series.dewPoint[4])]],
		['Opad powyżej skali', 6, 141, colors.overflow, [middle(1), precipitation.top + 3]],
		['Wilgotność względna', 6, 154, colors.humidity, [x(2), humidity.y(series.humidity[2])]],
		['Wystąpienie burzy', 6, 168, '#000', [middle(0) - 3, stormY]],
		['Deszcz:', 18, 182, colors.rain[0]],
		['max', 64, 182, colors.rain[0], [middle(0), precipitation.y(series.precipitationMax[0]) + 4]],
		['średni', 64, 194, colors.rain[0], [middle(2) - 2, precipitation.y(series.precipitationAverage[2]) + 6]],
		['Śnieg:', 18, 206, colors.snow[0]],
		['max', 64, 206, colors.snow[0], [middle(3), precipitation.y(series.precipitationMax[3]) + 3]],
		['średni', 64, 217, colors.snow[0], [middle(3) - 2, precipitation.y(series.precipitationAverage[3]) + 6]],
		['Opad mieszany', 6, 229, colors.mixed[0], [middle(5), precipitation.y(series.precipitationAverage[5]) + 2]],
		['Ciśnienie', 6, 266, '#000', [x(3), pressure.y(series.seaLevelPressure[3]) + 1]],
		['zredukowane', 6, 279, '#000'],
		['do poziomu morza', 6, 292, '#000'],
		['Wiatr na 10m:', 6, 322, '#000'],
		['poryw powyżej skali', 8, 336, colors.overflow, [middle(0) + 1, wind.top + 3]],
		['max porywy wiatru', 8, 351, colors.gust, [middle(3), wind.y(series.gust[3])]],
		['prędkość wiatru', 8, 372, colors.windLine, [x(3), wind.y(series.windSpeed[3])]],
		['w środku obszaru', 8, 385, colors.windLine],
		['kierunek wiatru', 6, 414, colors.windLine, [x(1) - 6, windDirectionY]],
		['Wierzchołek chmur', 6, 433, colors.cloudTop, [x(6), cloudBaseY(series.cloudTop[6])]],
		['Podstawa chmur*', 6, 447, '#000'],
		['o pokryciu', 6, 457, '#000'],
		['> 7.9 okt.', 14, 471, '#000', [x(4), cloudBaseY(series.cloudBase[4][4])]],
		['> 6.5 okt.', 14, 482, '#5A5A5A', [x(2), cloudBaseY(series.cloudBase[3][2])]],
		['> 4.5 okt.', 14, 494, '#969696', [x(3), cloudBaseY(series.cloudBase[2][3])]],
		['> 2.5 okt.', 14, 504, '#B4B4B4', [x(4), cloudBaseY(series.cloudBase[1][4])]],
		['> 0.1 okt.', 14, 515, SKY_BOX, [x(3), cloudBaseY(series.cloudBase[0][3])]],
		['Widzialność', 6, 530, colors.visibilityText, [x(5), visibilityY(series.visibility[5])]],
		['Chmury:', 6, 546, '#000'],
		['wysokie', 14, 560, SKY_BOX, [x(9), cloudCover.y(series.cloudHigh[9] * 8) + 3]],
		['średnie', 14, 573, '#969696', [x(7), cloudCover.y(series.cloudMedium[7] * 8) + 3]],
		['niskie', 14, 585, '#5A5A5A', [x(2), cloudCover.y(series.cloudLow[2] * 8) + 2]],
		['bardzo niskie', 14, 597, '#3C3C3C', [x(1), cloudCover.bottom - 2]],
		['Mgła', 6, 609, colors.visibilityText, [x(13), cloudCover.bottom - 2]],
		['Czas uniwersalny (UTC)', 6, 626, '#000', [x(4) - 8, 612]],
	]
}

function drawLegendLabel(ctx, [content, x, y, color, target]) {
	const isBox = color === SKY_BOX
	ctx.font = font(12)
	const width = ctx.measureText(content).width
	if (isBox) {
		ctx.fillStyle = SKY_BOX.background
		ctx.fillRect(x - 2, y - 10, width + 4, 13)
	}
	drawText(ctx, content, x, y, { color: isBox ? SKY_BOX.foreground : color })
	if (!target) return

	ctx.beginPath()
	ctx.moveTo(x + width + 2, y - 4)
	ctx.lineTo(target[0], target[1])
	ctx.strokeStyle = isBox ? SKY_BOX.background : color
	ctx.lineWidth = 1
	ctx.stroke()
}

function truncateToWidth(ctx, content, maxWidth) {
	let truncated = content
	while (truncated.length > 3 && ctx.measureText(truncated).width > maxWidth) {
		truncated = truncated.slice(0, -2)
	}
	if (truncated === content) return content
	return truncated.replace(/\s*\S?$/, '') + '…'
}

function drawLegend(ctx, { title, subtitle }) {
	const layout = createLayout({
		n: LEGEND_HOURS,
		left: 135,
		pxPerStep: PX_PER_HOUR,
		t0: 0,
		dt: HOUR_MS,
	})
	ctx.fillStyle = colors.page
	ctx.fillRect(0, 0, LEGEND_WIDTH, CHART_HEIGHT)

	// legend starts at 14 UTC, grid every 3 h
	drawPanels(ctx, {
		layout,
		series: legendSeries,
		ranges: legendRanges,
		nightSegments: [[layout.xAt(5), layout.xAt(13.7)]],
		gridXs: [1, 4, 7, 10, 13, 16].map(layout.xAt),
		pressureRightInHpa: true,
	})
	const timeLabels = [
		[4, '20', '18'],
		[10, '02', '00'],
		[16, '08', '06'],
	]
	for (const [index, local, utc] of timeLabels) {
		drawText(ctx, local, layout.xAt(index), 54, { align: 'center' })
		drawText(ctx, utc, layout.xAt(index), 616, { align: 'center' })
	}

	ctx.setLineDash([])
	for (const label of legendLabels(layout)) drawLegendLabel(ctx, label)
	drawText(ctx, '* powyżej poziomu morza', 6, 652, { size: 10 })

	// place name and model run
	if (title) {
		ctx.font = font(13, true)
		drawText(ctx, truncateToWidth(ctx, title, LEGEND_WIDTH - 100), 100, 11, {
			bold: true,
			size: 13,
		})
	}
	if (subtitle) drawText(ctx, subtitle, 100, 24, { size: 11, color: '#333' })
}

// ---------- public API ----------

export function render(ctx, model, options = {}) {
	ctx.save()
	if (options.legend !== false) {
		drawLegend(ctx, options)
		ctx.translate(LEGEND_WIDTH, 0)
	}
	drawChart(ctx, model, options)
	ctx.restore()
}

export function runLabel(model, modelName = 'um4_60') {
	const start = new Date(model.fstart)
	const hours = modelName === 'um4_120' ? '120h' : '60h'
	return `UM 4km ${hours}, start ${pad2(start.getUTCDate())}.${pad2(start.getUTCMonth() + 1)} ${pad2(start.getUTCHours())} UTC`
}

// data fetching (browser and Node 18+)
export async function fetchAvailable(fetchImpl = fetch) {
	const response = await fetchImpl(`${API_ORIGIN}/meteorograms/available`)
	if (!response.ok) throw new Error(`API meteo.pl: ${response.status}`)
	return response.json()
}

async function fetchLatestRuns(model, fetchImpl) {
	const available = await fetchAvailable(fetchImpl)
	const runs = [...(available[model] || [])].sort((a, b) => b - a)
	if (!runs.length) throw new Error(`Brak przebiegów modelu ${model}`)
	return runs
}

async function fetchRun({ lat, lon, model, run }, fetchImpl) {
	const response = await fetchImpl(`${API_ORIGIN}/meteorograms/${model}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			date: run,
			point: { lat: Number(lat), lon: Number(lon) },
		}),
	})
	if (!response.ok) throw new Error(`API meteo.pl: ${response.status}`)
	const forecast = normalizeApi(await response.json())
	if (forecast.n < 2) throw new Error('Za mało danych')
	return { ...forecast, run, model }
}

// the newest run may still be incomplete, so try up to the three latest
export async function fetchForecast(
	{ lat, lon, model = 'um4_60', date = null },
	fetchImpl = fetch,
) {
	const runs =
		date == null ? await fetchLatestRuns(model, fetchImpl) : [Number(date)]
	let lastError
	for (const run of runs.slice(0, 3)) {
		try {
			return await fetchRun({ lat, lon, model, run }, fetchImpl)
		} catch (error) {
			lastError = error
		}
	}
	throw lastError || new Error('Nie udało się pobrać prognozy')
}
