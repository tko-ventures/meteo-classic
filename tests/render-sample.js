// Renders a meteogram from the saved forecast to a PNG, to eyeball changes without network access.
// node tests/render-sample.js [file.png] [scale] [nolegend] [long]
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { measure, normalizeApi, render, runLabel } from '../render.js'
import { createForecastResponse } from './fixtures/meteo-api.js'

const [outputPath = '/tmp/meteogram-sample.png', scaleArg = '1', ...flags] =
	process.argv.slice(2)
const scale = Number(scaleArg)
const legend = !flags.includes('nolegend')
const long = flags.includes('long')

const require = createRequire(import.meta.url)
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

const model = normalizeApi(createForecastResponse({ long }))
const modelName = long ? 'um4_120' : 'um4_60'
const { width, height } = measure(model, { legend })
const canvas = createCanvas(
	Math.round(width * scale),
	Math.round(height * scale),
)
const ctx = canvas.getContext('2d')
ctx.scale(scale, scale)
render(ctx, model, {
	legend,
	title: 'Gdynia (punkt z wzoru)',
	subtitle: runLabel(model, modelName),
})
writeFileSync(outputPath, canvas.toBuffer('image/png'))
console.log(`${outputPath}: ${canvas.width}×${canvas.height}`)
