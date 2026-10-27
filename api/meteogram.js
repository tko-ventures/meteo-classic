// GET /meteogram/51.22,18.57.png or /meteogram.png?lat=51.22&lng=18.57
//     [&model=um4_60|um4_120][&legend=0][&scale=2][&name=Wieluń]
// Returns a PNG laid out like the old meteo.pl meteogram.
import { createRequire } from 'node:module'
import path from 'node:path'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { fetchForecast, measure, render, runLabel } from '../render.js'

const require = createRequire(import.meta.url)
let fontsRegistered = false

// Arimo is metric-compatible with Arial (SIL OFL 1.1), from the @expo-google-fonts/arimo npm package
function registerFonts() {
	if (fontsRegistered) return
	const fontDirectory = path.dirname(
		require.resolve('@expo-google-fonts/arimo/package.json'),
	)
	GlobalFonts.registerFromPath(
		path.join(fontDirectory, '400Regular', 'Arimo_400Regular.ttf'),
		'Arial',
	)
	GlobalFonts.registerFromPath(
		path.join(fontDirectory, '700Bold', 'Arimo_700Bold.ttf'),
		'Arial',
	)
	fontsRegistered = true
}

async function getPlaceName(lat, lon) {
	try {
		const response = await fetch(
			`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10&accept-language=pl`,
			{
				headers: {
					'User-Agent': 'meteo-classic/1.0 (nieoficjalny renderer meteogramow)',
				},
				signal: AbortSignal.timeout(2500),
			},
		)
		if (!response.ok) return null
		const place = await response.json()
		return place.name || null
	} catch {
		return null
	}
}

// /meteogram/51.22,18.57.png → coords=51.22,18.57 (rewrite in vercel.json)
function getCoordinates(query) {
	const pair =
		typeof query.coords === 'string'
			? decodeURIComponent(query.coords).split(',')
			: []
	if (pair.length === 2) return { lat: Number(pair[0]), lon: Number(pair[1]) }
	return { lat: Number(query.lat), lon: Number(query.lng ?? query.lon) }
}

function sendText(res, status, message) {
	res.status(status).setHeader('Content-Type', 'text/plain; charset=utf-8')
	res.end(message)
}

export default async function handler(req, res) {
	const query = req.query || {}
	const { lat, lon } = getCoordinates(query)
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
		sendText(
			res,
			400,
			'Podaj współrzędne, np. /meteogram/51.22,18.57.png albo /meteogram.png?lat=51.22&lng=18.57',
		)
		return
	}

	const model = query.model === 'um4_120' ? 'um4_120' : 'um4_60'
	const legend = !(query.legend === '0' || query.legend === 'false')
	const scale = Math.min(3, Math.max(1, Number(query.scale) || 1))

	try {
		registerFonts()
		const [forecast, name] = await Promise.all([
			fetchForecast({ lat, lon, model }),
			query.name ? String(query.name).slice(0, 60) : getPlaceName(lat, lon),
		])
		const { width, height } = measure(forecast, { legend })
		const canvas = createCanvas(
			Math.round(width * scale),
			Math.round(height * scale),
		)
		const ctx = canvas.getContext('2d')
		ctx.scale(scale, scale)
		render(ctx, forecast, {
			legend,
			title: name || `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
			subtitle: runLabel(forecast, model),
		})
		const png = await canvas.encode('png')

		res.setHeader('Content-Type', 'image/png')
		res.setHeader(
			'Cache-Control',
			'public, max-age=600, s-maxage=1800, stale-while-revalidate=3600',
		)
		res.setHeader('X-Model-Run', new Date(forecast.fstart).toISOString())
		res.status(200).end(png)
	} catch (error) {
		sendText(res, 502, `Nie udało się wygenerować meteogramu: ${error.message}`)
	}
}
