// Saved forecast for Gdynia and a stubbed fetch, so tests don't need the network.
import { readFileSync } from 'node:fs'
import { vi } from 'vitest'

const compact = JSON.parse(
	readFileSync(new URL('./forecast.json', import.meta.url), 'utf8'),
)

// how the API marks a missing value
const MISSING_VALUE = -327276480

export const forecastPoint = compact.point
export const forecastStart = compact.fstart

// expands the saved compact form into the POST /meteorograms/:model response shape;
// long = a series twice as long, like the 120 h model
export function createForecastResponse({ long = false } = {}) {
	const data = {}
	for (const [key, values] of Object.entries(compact)) {
		if (!Array.isArray(values)) continue
		const series = long ? [...values, ...values] : values
		data[key] = {
			data: series.map((value) => value ?? MISSING_VALUE),
			first_timestamp: compact.first,
			interval: 3600,
			point: compact.point,
			fstart: compact.fstart,
		}
	}
	return { fstart: compact.fstart, data }
}

export const availableRuns = {
	um4_60: [1792972800, 1792994400],
	um4_120: [1792972800],
}

function jsonResponse(body, status = 200) {
	return { ok: status < 400, status, json: async () => body }
}

// replaces the global fetch for the duration of a test (`using api = mockMeteoApi()`)
export function mockMeteoApi({
	forecast = createForecastResponse(),
	placeName = 'Gdynia',
	failingRuns = [],
} = {}) {
	const fetchMock = vi.fn(async (url, init) => {
		const href = String(url)
		if (href.endsWith('/meteorograms/available')) {
			return jsonResponse(availableRuns)
		}
		if (href.includes('/meteorograms/')) {
			const { date } = JSON.parse(init.body)
			if (failingRuns.includes(date)) return jsonResponse({}, 500)
			return jsonResponse(forecast)
		}
		if (href.includes('nominatim')) return jsonResponse({ name: placeName })
		throw new Error(`Unexpected request: ${href}`)
	})
	vi.stubGlobal('fetch', fetchMock)
	return {
		fetch: fetchMock,
		[Symbol.dispose]: () => vi.unstubAllGlobals(),
	}
}
