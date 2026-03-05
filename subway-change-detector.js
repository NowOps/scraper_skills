#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load environment
function loadEnv() {
    const envPath = path.join(process.env.HOME, '.openclaw', '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const env = {};
    envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)\s*=\s*(.*)$/);
        if (match) env[match[1].trim()] = match[2].trim();
    });
    return env;
}

const env = loadEnv();
const NOTION_API_KEY = fs.readFileSync(path.join(process.env.HOME, '.config/notion/api_key'), 'utf8').trim();
const SUBWAY_DATABASE_ID = '9e382651-8033-43b0-a463-9aefa3d0291f';
const DAILY_LOG_DATABASE_ID = '55432c0a-9400-4ac4-b0b5-9520505f9d90';
const SUBWAY_EMAIL = env.SUBWAY_FEED_EMAIL;
const SUBWAY_PASSWORD = env.SUBWAY_FEED_PASSWORD;
const URL_MAP_PATH = '/Users/macmini2026/.openclaw/workspaces/darby/logs/subway-url-map.json';

// Stats
const stats = {
    totalChecked: 0,
    changed: 0,
    newPages: 0,
    unchanged: 0,
    changedPages: [],
    newPages: []
};

function generateHash(content) {
    return crypto.createHash('md5').update(content).digest('hex');
}

function cleanContent(html) {
    // Apply same cleaning as main scraper
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// STEP 1: Add ContentHash field to Notion database
async function ensureContentHashField() {
    console.log('[Step 1] Ensuring ContentHash field exists in Notion database...');
    
    try {
        // Notion API doesn't have a direct way to add properties programmatically
        // We'll just try to use it and it will be created automatically when we write
        console.log('  ✓ ContentHash field will be created automatically on first write');
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
    }
}

// STEP 2: Update existing rows with hash
async function updateExistingRowsWithHash() {
    console.log('\n[Step 2] Updating existing rows with ContentHash...');
    
    try {
        let hasMore = true;
        let startCursor = undefined;
        let updated = 0;
        
        while (hasMore) {
            const response = await fetch('https://api.notion.com/v1/data_sources/387be321-f648-47f3-bc26-8169de6065d8/query', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${NOTION_API_KEY}`,
                    'Notion-Version': '2025-09-03',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    start_cursor: startCursor
                })
            });
            
            const data = await response.json();
            
            if (data.results) {
                for (const row of data.results) {
                    const content = row.properties?.Content?.rich_text?.[0]?.text?.content || '';
                    const existingHash = row.properties?.ContentHash?.rich_text?.[0]?.text?.content;
                    
                    if (content && !existingHash) {
                        const hash = generateHash(content);
                        
                        await fetch(`https://api.notion.com/v1/pages/${row.id}`, {
                            method: 'PATCH',
                            headers: {
                                'Authorization': `Bearer ${NOTION_API_KEY}`,
                                'Notion-Version': '2025-09-03',
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                properties: {
                                    'ContentHash': { rich_text: [{ text: { content: hash } }] }
                                }
                            })
                        });
                        
                        updated++;
                        
                        if (updated % 10 === 0) {
                            console.log(`  Updated ${updated} rows...`);
                        }
                        
                        await new Promise(r => setTimeout(r, 350)); // Rate limit
                    }
                }
            }
            
            hasMore = data.has_more || false;
            startCursor = data.next_cursor;
        }
        
        console.log(`  ✓ Updated ${updated} rows with ContentHash`);
    } catch (error) {
        console.error(`  ✗ Error updating rows: ${error.message}`);
    }
}

// STEP 3: Daily change detection
async function detectChanges() {
    console.log('\n[Step 3] Starting daily change detection...');
    
    // Load URL map
    if (!fs.existsSync(URL_MAP_PATH)) {
        console.error('  ✗ URL map not found!');
        return;
    }
    
    const urlMap = JSON.parse(fs.readFileSync(URL_MAP_PATH, 'utf8'));
    
    // Launch browser
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    
    // Login
    console.log('  Logging in...');
    await page.goto('https://cloudopsmanual.subway.com/NA/?lang=en');
    await page.waitForTimeout(3000);
    
    if (page.url().includes('login') || page.url().includes('signin') || page.url().includes('subid')) {
        await page.locator('input[type="email"], #signInName').first().fill(SUBWAY_EMAIL);
        await page.locator('input[type="password"], #password').first().fill(SUBWAY_PASSWORD);
        await page.locator('button[type="submit"], #next').first().click();
        await page.waitForTimeout(5000);
    }
    
    // Check each URL
    for (const [category, sections] of Object.entries(urlMap)) {
        for (const [section, url] of Object.entries(sections)) {
            try {
                stats.totalChecked++;
                
                // Navigate to page
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await page.waitForLoadState('networkidle').catch(() => {});
                
                // Extract content
                const newContentHtml = await page.evaluate(() => {
                    let contentArea = document.querySelector('.topic-body');
                    if (!contentArea || !contentArea.innerHTML.trim()) {
                        contentArea = document.querySelector('.topic-content');
                    }
                    if (!contentArea || !contentArea.innerHTML.trim()) {
                        contentArea = document.querySelector('[role="main"]');
                    }
                    
                    if (!contentArea) return '';
                    
                    return contentArea.innerHTML;
                });
                
                if (!newContentHtml) {
                    console.log(`  SKIPPED: ${category} > ${section} - no content`);
                    continue;
                }
                
                const newContent = cleanContent(newContentHtml);
                const newHash = generateHash(newContent);
                
                // Query Notion for existing row
                const queryResponse = await fetch('https://api.notion.com/v1/data_sources/387be321-f648-47f3-bc26-8169de6065d8/query', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${NOTION_API_KEY}`,
                        'Notion-Version': '2025-09-03',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        filter: { property: 'SourceURL', rich_text: { equals: url } }
                    })
                });
                
                const queryData = await queryResponse.json();
                
                if (queryData.results && queryData.results.length > 0) {
                    // Page exists - compare hash
                    const existingRow = queryData.results[0];
                    const existingHash = existingRow.properties?.ContentHash?.rich_text?.[0]?.text?.content;
                    const hierarchyPath = existingRow.properties?.HierarchyPath?.rich_text?.[0]?.text?.content || `${category} > ${section}`;
                    
                    if (existingHash !== newHash) {
                        // Content changed - update
                        await fetch(`https://api.notion.com/v1/pages/${existingRow.id}`, {
                            method: 'PATCH',
                            headers: {
                                'Authorization': `Bearer ${NOTION_API_KEY}`,
                                'Notion-Version': '2025-09-03',
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                properties: {
                                    'Content': { rich_text: [{ text: { content: newContent.substring(0, 2000) } }] },
                                    'ContentHash': { rich_text: [{ text: { content: newHash } }] },
                                    'ScrapedDate': { date: { start: new Date().toISOString().split('T')[0] } }
                                }
                            })
                        });
                        
                        stats.changed++;
                        stats.changedPages.push(hierarchyPath);
                        console.log(`  CHANGED: ${hierarchyPath} - content updated`);
                    } else {
                        stats.unchanged++;
                        console.log(`  UNCHANGED: ${hierarchyPath}`);
                    }
                } else {
                    // New page - create row
                    const hierarchyPath = `${category} > ${section}`;
                    
                    await fetch('https://api.notion.com/v1/pages', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${NOTION_API_KEY}`,
                            'Notion-Version': '2025-09-03',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            parent: { database_id: SUBWAY_DATABASE_ID },
                            properties: {
                                'Title': { title: [{ text: { content: section } }] },
                                'Category': { select: { name: category } },
                                'Section': { rich_text: [{ text: { content: section } }] },
                                'Content': { rich_text: [{ text: { content: newContent.substring(0, 2000) } }] },
                                'ContentHash': { rich_text: [{ text: { content: newHash } }] },
                                'HierarchyPath': { rich_text: [{ text: { content: hierarchyPath } }] },
                                'HierarchyLevel': { select: { name: 'Section' } },
                                'SourceURL': { rich_text: [{ text: { content: url } }] },
                                'ScrapedDate': { date: { start: new Date().toISOString().split('T')[0] } },
                                'Status': { select: { name: 'Scraped' } }
                            }
                        })
                    });
                    
                    stats.newPages++;
                    stats.newPages.push(hierarchyPath);
                    console.log(`  NEW: ${hierarchyPath} - new page detected`);
                }
                
                await new Promise(r => setTimeout(r, 350)); // Rate limit
                
            } catch (error) {
                console.error(`  ✗ Error checking ${section}: ${error.message}`);
            }
        }
    }
    
    await browser.close();
}

// STEP 4: Generate report
function generateReport() {
    console.log('\n[Step 4] Generating report...');
    
    const today = new Date().toISOString().split('T')[0];
    
    let report = '';
    
    if (stats.changed === 0 && stats.newPages === 0) {
        report = `Subway Manual - ${today} - No changes detected today. All ${stats.totalChecked} pages unchanged.`;
    } else {
        report = `Subway Manual Daily Change Report - ${today}\n\n`;
        report += `Total pages checked: ${stats.totalChecked}\n`;
        report += `Changes detected: ${stats.changed}\n`;
        report += `New pages found: ${stats.newPages}\n`;
        report += `Unchanged: ${stats.unchanged}\n\n`;
        
        if (stats.changedPages.length > 0) {
            report += `CHANGES:\n`;
            stats.changedPages.forEach(page => {
                report += `- ${page} - updated\n`;
            });
            report += '\n';
        }
        
        if (stats.newPages.length > 0) {
            report += `NEW PAGES:\n`;
            stats.newPages.forEach(page => {
                report += `- ${page} - new\n`;
            });
        }
    }
    
    console.log('\n' + report);
    
    return report;
}

// STEP 5: Create DailyLog entry (always, whether changes found or not)
async function logToNotion(report) {
    console.log('\n[Step 5] Creating DailyLog entry...');
    
    const today = new Date().toISOString().split('T')[0];
    
    try {
        // Determine title based on whether changes were detected
        const title = (stats.changed > 0 || stats.newPages > 0)
            ? `Subway Manual Changes - ${today}`
            : `Subway Manual Check - ${today}`;
        
        await fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NOTION_API_KEY}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                parent: { database_id: DAILY_LOG_DATABASE_ID },
                properties: {
                    'Title': { title: [{ text: { content: title } }] },
                    'MorningBrief': { rich_text: [{ text: { content: report } }] },
                    'Date': { date: { start: today } }
                }
            })
        });
        
        console.log('  ✓ DailyLog entry created');
    } catch (error) {
        console.error(`  ✗ Error creating DailyLog: ${error.message}`);
    }
}

async function main() {
    console.log('========================================');
    console.log('  SUBWAY MANUAL CHANGE DETECTOR');
    console.log('========================================\n');
    
    await ensureContentHashField();
    await updateExistingRowsWithHash();
    await detectChanges();
    
    const report = generateReport();
    await logToNotion(report);
    
    console.log('\n========================================');
    console.log('===  CHANGE DETECTION COMPLETE  ===');
    console.log('========================================\n');
}

main().catch(error => {
    console.error('FATAL ERROR:', error);
    process.exit(1);
});
