import { expect, test } from 'vitest'
import handler from '../api/meteogram.js'
import {
	createForecastResponse,
	forecastStart,
	mockMeteoApi,
} from './fixtures/meteo-api.js'

function createResponse() {
	return {
		statusCode: 0,
		headers: {},
		body: undefined,
		status(code) {
			this.statusCode = code
			return this
		},
		setHeader(name, value) {
			this.headers[name] = value
			return this
		},
		end(body) {
			this.body = body
		},
	}
}

async function requestMeteogram(query) {
	const res = createResponse()
	await handler({ query }, res)
	return res
}

// width and height from the PNG's IHDR header
function pngSize(buffer) {
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47])

test('renders a PNG meteogram for coordinates in the path', async () => {
	using api = mockMeteoApi()
	const res = await requestMeteogram({ coords: '54.4853,18.4708' })

	expect(res.statusCode).toBe(200)
	expect(res.headers['Content-Type']).toBe('image/png')
	expect(res.headers['Cache-Control']).toMatch(/s-maxage=1800/)
	expect(res.headers['X-Model-Run']).toBe(new Date(forecastStart).toISOString())
	expect(res.body.subarray(0, 4)).toEqual(PNG_SIGNATURE)
	expect(pngSize(res.body)).toEqual({ width: 820, height: 660 })
	expect(api.fetch).toHaveBeenCalledWith(
		expect.stringContaining('nominatim.openstreetmap.org/reverse'),
		expect.anything(),
	)
})

test('accepts lat/lng query params like meteo.pl links', async () => {
	using _api = mockMeteoApi()
	const res = await requestMeteogram({ lat: '54.4853', lng: '18.4708' })

	expect(res.statusCode).toBe(200)
	expect(res.headers['Content-Type']).toBe('image/png')
})

test('leaves out the legend and scales the image on request', async () => {
	using _api = mockMeteoApi()
	const res = await requestMeteogram({
		coords: '54.4853,18.4708',
		legend: '0',
		scale: '2',
	})

	expect(res.statusCode).toBe(200)
	expect(pngSize(res.body)).toEqual({ width: 1080, height: 1320 })
})

test('the 120 h model draws its longer forecast on a wider chart', async () => {
	using api = mockMeteoApi({ forecast: createForecastResponse({ long: true }) })
	const res = await requestMeteogram({
		coords: '54.4853,18.4708',
		model: 'um4_120',
	})

	expect(res.statusCode).toBe(200)
	expect(pngSize(res.body).width).toBeGreaterThan(820)
	expect(api.fetch).toHaveBeenCalledWith(
		expect.stringMatching(/\/meteorograms\/um4_120$/),
		expect.anything(),
	)
})

test('uses the name param instead of looking the place up', async () => {
	using api = mockMeteoApi()
	await requestMeteogram({ coords: '54.4853,18.4708', name: 'Orłowo' })

	expect(api.fetch).not.toHaveBeenCalledWith(
		expect.stringContaining('nominatim'),
		expect.anything(),
	)
})

test('responds 400 when coordinates are missing', async () => {
	const res = await requestMeteogram({})

	expect(res.statusCode).toBe(400)
	expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8')
	expect(res.body).toMatch(/Podaj współrzędne/)
})

test('responds 502 when the meteo.pl API fails', async () => {
	using _api = mockMeteoApi({ failingRuns: [1792994400, 1792972800] })
	const res = await requestMeteogram({ coords: '54.4853,18.4708' })

	expect(res.statusCode).toBe(502)
	expect(res.body).toBe(
		'Nie udało się wygenerować meteogramu: API meteo.pl: 500',
	)
})
