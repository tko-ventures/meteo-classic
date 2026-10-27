import { expect, test } from 'vitest'
import {
	fetchForecast,
	localParts,
	measure,
	normalizeApi,
	runLabel,
	solarAltitude,
} from '../render.js'
import {
	availableRuns,
	createForecastResponse,
	forecastPoint,
	mockMeteoApi,
} from './fixtures/meteo-api.js'

test('normalizeApi turns the API response into hourly series', () => {
	const model = normalizeApi(createForecastResponse())

	expect(model.n).toBe(60)
	expect(model.dt).toBe(3_600_000)
	expect(model.t0).toBe(1792998000 * 1000)
	expect(model.point).toEqual(forecastPoint)
	expect(model.s.airtmp_point[0]).toBe(6.6)
})

test('normalizeApi replaces missing values with null', () => {
	const model = normalizeApi({
		fstart: '2026-10-26T06:00:00Z',
		data: {
			airtmp_point: { data: [1, -327276480, null, 2], first_timestamp: '0' },
		},
	})

	expect(model.s.airtmp_point).toEqual([1, null, null, 2])
})

test('normalizeApi rejects a response without series', () => {
	expect(() => normalizeApi({ data: {} })).toThrow(
		'Brak danych w odpowiedzi API',
	)
})

test('measure adds room for the legend unless it is turned off', () => {
	const model = normalizeApi(createForecastResponse())

	expect(measure(model)).toEqual({ width: 820, height: 660 })
	expect(measure(model, { legend: false })).toEqual({ width: 540, height: 660 })
})

test('runLabel describes the model run in UTC', () => {
	const model = normalizeApi(createForecastResponse())

	expect(runLabel(model)).toBe('UM 4km 60h, start 26.10 06 UTC')
	expect(runLabel(model, 'um4_120')).toBe('UM 4km 120h, start 26.10 06 UTC')
})

test('localParts reports Polish winter and summer time', () => {
	expect(localParts(Date.parse('2026-01-15T12:00:00Z'))).toMatchObject({
		hour: 13,
		abbreviation: 'CET',
	})
	expect(localParts(Date.parse('2026-07-15T12:00:00Z'))).toMatchObject({
		hour: 14,
		abbreviation: 'CEST',
	})
})

test('solarAltitude puts the sun high at summer noon and below the horizon at midnight', () => {
	const warsaw = [52.23, 21.01]

	expect(
		solarAltitude(Date.parse('2026-06-21T10:45:00Z'), ...warsaw),
	).toBeGreaterThan(60)
	expect(
		solarAltitude(Date.parse('2026-06-21T22:45:00Z'), ...warsaw),
	).toBeLessThan(0)
})

test('fetchForecast falls back to an older run when the newest one fails', async () => {
	const [olderRun, newestRun] = availableRuns.um4_60
	using api = mockMeteoApi({ failingRuns: [newestRun] })

	const forecast = await fetchForecast({ lat: 54.48, lon: 18.47 })

	expect(forecast.run).toBe(olderRun)
	expect(forecast.model).toBe('um4_60')
	expect(api.fetch).toHaveBeenCalledTimes(3)
})
