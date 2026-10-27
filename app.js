import {
	fetchAvailable,
	fetchForecast,
	measure,
	render,
	runLabel,
} from './render.js'

const DEFAULT_MODEL = 'um4_60'
const DEFAULT_LOCATION = { lat: 52.41, lon: 16.93, name: 'Poznań' }

const elements = {
	form: document.querySelector('#search'),
	query: document.querySelector('#q'),
	results: document.querySelector('#results'),
	model: document.querySelector('#model'),
	run: document.querySelector('#run'),
	legend: document.querySelector('#legend'),
	scale: document.querySelector('#scale'),
	download: document.querySelector('#download'),
	share: document.querySelector('#share'),
	status: document.querySelector('#status'),
	stage: document.querySelector('#stage'),
	linkBox: document.querySelector('#linkbox'),
	linkUrl: document.querySelector('#linkurl'),
	copy: document.querySelector('#copy'),
	open: document.querySelector('#open'),
}

const state = {
	lat: null,
	lon: null,
	name: '',
	model: DEFAULT_MODEL,
	legend: true,
	run: '',
	data: null,
	objectUrl: null,
}
let availableRuns = null
let latestRequestId = 0

// localStorage may be unavailable (e.g. a private window); then we simply remember nothing
const storage = {
	get(key) {
		try {
			return JSON.parse(localStorage.getItem(key))
		} catch {
			return null
		}
	},
	set(key, value) {
		try {
			localStorage.setItem(key, JSON.stringify(value))
		} catch {}
	},
}

function setStatus(html, isError = false) {
	elements.status.innerHTML = html
	elements.status.classList.toggle('err', isError)
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

function escapeHtml(value) {
	return String(value).replace(
		/[&<>"]/g,
		(character) => HTML_ESCAPES[character],
	)
}

function pad2(number) {
	return String(number).padStart(2, '0')
}

function formatRun(seconds) {
	const date = new Date(seconds * 1000)
	return `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)} ${pad2(date.getUTCHours())} UTC`
}

function formatCoordinates(lat, lon, digits) {
	return `${lat.toFixed(digits)}, ${lon.toFixed(digits)}`
}

function placeLabel() {
	return state.name || formatCoordinates(state.lat, state.lon, 3)
}

const COORDINATE_PAIR = /(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/
const TYPED_COORDINATES =
	/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/

function parseUrlCoordinates(input) {
	let url
	try {
		url = new URL(input)
	} catch {
		return null
	}
	const lat = url.searchParams.get('lat')
	const lon = url.searchParams.get('lng') ?? url.searchParams.get('lon')
	if (lat && lon) return { lat: Number(lat), lon: Number(lon) }

	const match = url.pathname.match(COORDINATE_PAIR)
	if (match) return { lat: Number(match[1]), lon: Number(match[2]) }
	return null
}

// coordinates from typed text or a meteo.pl / app.meteo.pl link
function parseCoordinates(input) {
	const trimmed = input.trim()
	const fromUrl = parseUrlCoordinates(trimmed)
	if (fromUrl) return fromUrl

	const match = trimmed.match(TYPED_COORDINATES)
	if (!match) return null
	const toNumber = (value) => Number(value.replace(',', '.'))
	return { lat: toNumber(match[1]), lon: toNumber(match[2]) }
}

async function searchPlaces(query) {
	const response = await fetch(
		`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=6&accept-language=pl`,
	)
	if (!response.ok) throw new Error('wyszukiwarka miejsc nie odpowiada')
	return response.json()
}

async function getPlaceName(lat, lon) {
	try {
		const response = await fetch(
			`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10&accept-language=pl`,
		)
		if (!response.ok) return ''
		const place = await response.json()
		return place.name || ''
	} catch {
		return ''
	}
}

function placeName(place) {
	return place.name || place.display_name.split(',')[0]
}

function hideResults() {
	elements.results.hidden = true
	elements.results.innerHTML = ''
}

function showResults(places) {
	elements.results.innerHTML = ''
	for (const place of places) {
		const item = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		const region = place.display_name.split(',').slice(1, 4).join(',').trim()
		button.innerHTML = `${escapeHtml(placeName(place))} <small>${escapeHtml(region)}</small>`
		button.addEventListener('click', () => {
			hideResults()
			selectLocation(Number(place.lat), Number(place.lon), placeName(place))
		})
		item.append(button)
		elements.results.append(item)
	}
	elements.results.hidden = false
	elements.results.querySelector('button')?.focus()
}

function selectLocation(lat, lon, name) {
	state.lat = lat
	state.lon = lon
	state.name = name || ''
	elements.query.value = name || formatCoordinates(lat, lon, 4)
	storage.set('loc', { lat, lon, name: state.name })
	void drawForecast()
}

async function loadRuns() {
	try {
		availableRuns ??= await fetchAvailable()
		const runs = [...(availableRuns[state.model] || [])].sort((a, b) => b - a)
		elements.run.innerHTML =
			'<option value="">najnowszy</option>' +
			runs
				.map((run) => `<option value="${run}">${formatRun(run)}</option>`)
				.join('')
		elements.run.value = runs.includes(Number(state.run)) ? state.run : ''
		state.run = elements.run.value
	} catch {
		// the run list is optional; without it we draw the latest run
	}
}

function renderToCanvas(scale) {
	const options = {
		legend: state.legend,
		title: placeLabel(),
		subtitle: runLabel(state.data, state.model),
	}
	const { width, height } = measure(state.data, options)
	const canvas = document.createElement('canvas')
	canvas.width = Math.round(width * scale)
	canvas.height = Math.round(height * scale)
	const ctx = canvas.getContext('2d')
	ctx.scale(scale, scale)
	render(ctx, state.data, options)
	return { canvas, width, height }
}

function showMeteogram() {
	const pixelRatio = Math.min(
		3,
		Math.max(1, Math.ceil(window.devicePixelRatio || 1)),
	)
	const { canvas, width, height } = renderToCanvas(pixelRatio)
	canvas.toBlob((blob) => {
		if (!blob) return
		if (state.objectUrl) URL.revokeObjectURL(state.objectUrl)
		state.objectUrl = URL.createObjectURL(blob)
		const image = new Image(width, height)
		image.src = state.objectUrl
		image.alt = `Meteogram dla: ${state.name || 'wybranego punktu'}`
		elements.stage.replaceChildren(image)
	}, 'image/png')
}

// URLs as on app.meteo.pl: /meteogram/51.22,18.57 (page) and /meteogram/51.22,18.57.png (image)
function coordinatesPath() {
	return `/meteogram/${Number(state.lat.toFixed(4))},${Number(state.lon.toFixed(4))}`
}

function coordinatesFromPath(pathname) {
	const match = decodeURIComponent(pathname).match(
		/^\/meteogram\/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\/?$/,
	)
	if (!match) return null
	return { lat: Number(match[1]), lon: Number(match[2]) }
}

function urlWithOptions(path) {
	const url = new URL(path, location.origin)
	if (state.name) url.searchParams.set('name', state.name)
	if (state.model !== DEFAULT_MODEL) url.searchParams.set('model', state.model)
	if (!state.legend) url.searchParams.set('legend', '0')
	return url
}

function syncUrl() {
	history.replaceState(null, '', urlWithOptions(coordinatesPath()))
}

function pngLink() {
	return urlWithOptions(`${coordinatesPath()}.png`).toString()
}

function setExportEnabled(enabled) {
	elements.download.disabled = !enabled
	elements.share.disabled = !enabled
}

async function drawForecast() {
	if (state.lat == null) return
	const requestId = ++latestRequestId
	const isStale = () => requestId !== latestRequestId

	setExportEnabled(false)
	elements.linkBox.classList.remove('show')
	setStatus(`Pobieranie prognozy dla <b>${escapeHtml(placeLabel())}</b>…`)
	syncUrl()

	try {
		const data = await fetchForecast({
			lat: state.lat,
			lon: state.lon,
			model: state.model,
			date: state.run || null,
		})
		if (isStale()) return
		state.data = data

		if (!state.name) {
			state.name = await getPlaceName(state.lat, state.lon)
			if (state.name) {
				elements.query.value = state.name
				syncUrl()
			}
		}
		showMeteogram()

		const gridPoint = data.point || {}
		const gridLat = gridPoint.lat?.toFixed?.(4) ?? state.lat
		const gridLon = gridPoint.lon?.toFixed?.(4) ?? state.lon
		setStatus(
			`<b>${escapeHtml(state.name || 'Punkt')}</b> · ${runLabel(data, state.model)} · punkt siatki ${gridLat}, ${gridLon}`,
		)
		setExportEnabled(true)
	} catch (error) {
		if (isStale()) return
		setStatus(
			`Nie udało się pobrać prognozy: ${escapeHtml(error.message)}. Punkt musi leżeć w obszarze modelu UM (Polska i okolice).`,
			true,
		)
	}
}

function fileSlug(name) {
	return name
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/ł/g, 'l')
		.replace(/[^a-z0-9]+/g, '-')
}

function downloadFileName() {
	const start = new Date(state.data.fstart)
	const runStamp = `${start.getUTCFullYear()}${pad2(start.getUTCMonth() + 1)}${pad2(start.getUTCDate())}${pad2(start.getUTCHours())}`
	return `meteogram-${fileSlug(state.name || 'punkt')}-${runStamp}.png`
}

async function handleSearch(event) {
	event.preventDefault()
	const query = elements.query.value.trim()
	if (!query) return

	const coordinates = parseCoordinates(query)
	if (
		coordinates &&
		Number.isFinite(coordinates.lat) &&
		Number.isFinite(coordinates.lon)
	) {
		hideResults()
		selectLocation(coordinates.lat, coordinates.lon, '')
		return
	}

	setStatus('Szukam…')
	try {
		const places = await searchPlaces(query)
		if (!places.length) {
			setStatus(`Nie znaleziono: <b>${escapeHtml(query)}</b>`, true)
			return
		}
		setStatus('')
		if (places.length > 1) {
			showResults(places)
			return
		}
		const [place] = places
		selectLocation(Number(place.lat), Number(place.lon), place.name)
	} catch (error) {
		setStatus(`Błąd wyszukiwania: ${escapeHtml(error.message)}`, true)
	}
}

elements.form.addEventListener('submit', handleSearch)

document.addEventListener('click', (event) => {
	if (!elements.form.contains(event.target)) hideResults()
})

document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape') hideResults()
})

elements.model.addEventListener('change', async () => {
	state.model = elements.model.value
	state.run = ''
	storage.set('model', state.model)
	await loadRuns()
	void drawForecast()
})

elements.run.addEventListener('change', () => {
	state.run = elements.run.value
	void drawForecast()
})

elements.legend.addEventListener('change', () => {
	state.legend = elements.legend.checked
	storage.set('legend', state.legend)
	if (!state.data) return
	showMeteogram()
	syncUrl()
})

elements.download.addEventListener('click', () => {
	const { canvas } = renderToCanvas(Number(elements.scale.value) || 1)
	canvas.toBlob((blob) => {
		const link = document.createElement('a')
		link.download = downloadFileName()
		link.href = URL.createObjectURL(blob)
		link.click()
		setTimeout(() => URL.revokeObjectURL(link.href), 2000)
	}, 'image/png')
})

elements.share.addEventListener('click', () => {
	const link = pngLink()
	elements.linkUrl.value = link
	elements.open.href = link
	elements.linkBox.classList.add('show')
	elements.linkUrl.select()
})

elements.copy.addEventListener('click', async () => {
	try {
		await navigator.clipboard.writeText(elements.linkUrl.value)
	} catch {
		elements.linkUrl.select()
		document.execCommand?.('copy')
	}
	elements.copy.textContent = 'Skopiowano'
	setTimeout(() => {
		elements.copy.textContent = 'Kopiuj'
	}, 1500)
})

function isDisabledFlag(value) {
	return value === '0' || value === 'false'
}

// startup: URL params > last location > Poznań
async function init() {
	const params = new URLSearchParams(location.search)
	const fromPath = coordinatesFromPath(location.pathname)
	const lat = fromPath ? fromPath.lat : parseFloat(params.get('lat'))
	const lon = fromPath
		? fromPath.lon
		: parseFloat(params.get('lng') ?? params.get('lon'))

	state.model =
		params.get('model') === 'um4_120'
			? 'um4_120'
			: storage.get('model') || DEFAULT_MODEL
	state.legend = params.has('legend')
		? !isDisabledFlag(params.get('legend'))
		: (storage.get('legend') ?? true)
	elements.model.value = state.model
	elements.legend.checked = state.legend
	await loadRuns()

	if (Number.isFinite(lat) && Number.isFinite(lon)) {
		selectLocation(lat, lon, params.get('name') || '')
		return
	}
	const lastLocation = storage.get('loc')
	if (lastLocation && Number.isFinite(lastLocation.lat)) {
		selectLocation(lastLocation.lat, lastLocation.lon, lastLocation.name)
		return
	}
	selectLocation(
		DEFAULT_LOCATION.lat,
		DEFAULT_LOCATION.lon,
		DEFAULT_LOCATION.name,
	)
}

void init()
