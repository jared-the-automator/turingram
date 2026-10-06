#!/usr/bin/env node
/**
 * Visits each competitor's pricing page, takes a screenshot, and uses
 * Gemini Flash (free tier) to extract the current price for the main individual plan.
 * Writes results to public/prices.json for the marketing site to fetch at runtime.
 *
 * Usage: node scripts/update-prices.mjs
 * Requires: GEMINI_API_KEY env var, Playwright chromium installed
 *
 * Free tier: ~1,500 requests/day on Gemini Flash. This script uses 2.
 * Get a key free at: aistudio.google.com
 */

import { GoogleGenAI } from '@google/genai'
import { chromium } from 'playwright'
import { writeFileSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = join(__dirname, '..', 'public', 'prices.json')

// Verified 2026-06-01: gemini-3.5-flash is the current free-tier flagship with vision support
// Source: https://ai.google.dev/gemini-api/docs/pricing
const GEMINI_MODEL = 'gemini-3.5-flash'

const TARGETS = [
  {
    key: 'otter',
    name: 'Otter.ai',
    url: 'https://otter.ai/pricing',
    hint: 'the main individual paid plan (not the free tier, not Business or Enterprise)',
  },
  {
    key: 'fireflies',
    name: 'Fireflies.ai',
    url: 'https://fireflies.ai/pricing',
    hint: 'the main individual paid plan (not the free tier, not Business or Enterprise)',
  },
]

async function extractPrice(screenshotBuffer, target, ai) {
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: screenshotBuffer.toString('base64'),
            },
          },
          {
            text:
              `This is a screenshot of ${target.name}'s pricing page. ` +
              `Find ${target.hint}. ` +
              `Return JSON only, no other text: {"price": number_or_null, "currency": "USD", "period": "month", "planName": "string_or_null"}. ` +
              `If the monthly price is not clearly visible, return {"price": null}.`,
          },
        ],
      },
    ],
  })

  const text = response.text?.trim() ?? ''
  try {
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(clean)
  } catch {
    console.warn(`[${target.key}] Could not parse response:`, text)
    return { price: null, currency: 'USD', period: 'month', planName: null }
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set. Get one free at aistudio.google.com')
    process.exit(1)
  }

  const ai = new GoogleGenAI({ apiKey })
  const browser = await chromium.launch({ headless: true })
  const results = {}

  for (const target of TARGETS) {
    console.log(`[${target.key}] Visiting ${target.url}`)
    try {
      const page = await browser.newPage()
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto(target.url, { waitUntil: 'load', timeout: 45_000 })
      await page.waitForTimeout(1500)
      const screenshot = await page.screenshot({ fullPage: false })
      await page.close()

      console.log(`[${target.key}] Extracting price with ${GEMINI_MODEL}`)
      const priceData = await extractPrice(screenshot, target, ai)
      console.log(`[${target.key}]`, priceData)

      results[target.key] = { name: target.name, url: target.url, ...priceData }
    } catch (err) {
      console.error(`[${target.key}] Failed:`, err.message)
      results[target.key] = {
        name: target.name,
        url: target.url,
        price: null,
        currency: 'USD',
        period: 'month',
        planName: null,
      }
    }
  }

  await browser.close()

  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ lastVerified: new Date().toISOString(), services: results }, null, 2) + '\n',
  )
  console.log('prices.json updated.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
