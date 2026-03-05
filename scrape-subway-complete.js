#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const TurndownService = require('turndown');

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
const SUBWAY_EMAIL = env.SUBWAY_FEED_EMAIL;
const SUBWAY_PASSWORD = env.SUBWAY_FEED_PASSWORD;
const ASSETS_DIR = '/Users/macmini2026/.openclaw/workspaces/darby/assets/subway-images';
const URL_MAP_PATH = '/Users/macmini2026/.openclaw/workspaces/darby/logs/subway-url-map.json';

// Configure Turndown
const turndownService = new TurndownService({ 
    codeBlockStyle: 'fenced',
    headingStyle: 'atx',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    br: '\n'
});

// Override heading rules to make them UPPERCASE plain text
turndownService.addRule('headings', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: function(content) {
        return '\n\n' + content.toUpperCase() + '\n\n';
    }
});

// FIX 2: TABLE FORMATTING - Convert tables to readable plain text format with line breaks
turndownService.addRule('tablesPlainText', {
    filter: 'table',
    replacement: function(content, node) {
        const rows = Array.from(node.querySelectorAll('tr'));
        const result = [];
        
        // Get headers
        const headers = [];
        const headerCells = rows[0]?.querySelectorAll('th, td');
        if (headerCells) {
            headerCells.forEach(cell => {
                headers.push(cell.textContent.trim());
            });
        }
        
        // Process data rows with line breaks between fields
        rows.slice(1).forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            const rowLines = [];
            
            cells.forEach((cell, i) => {
                const header = headers[i] || `Column${i + 1}`;
                const value = cell.textContent.trim();
                rowLines.push(`${header}: ${value}`);
            });
            
            result.push(rowLines.join('\n'));
        });
        
        return '\n\n' + result.join('\n---\n\n') + '\n\n';
    }
});

// Preserve line breaks
turndownService.addRule('preserveLineBreaks', {
    filter: ['p', 'div'],
    replacement: function(content, node) {
        if (!content.trim()) return '';
        return '\n\n' + content.trim() + '\n\n';
    }
});

// Stats
let totalWrites = 0;

// URL tracking
let urlMap = {};
let discoveredUrls = new Set();

function loadUrlMap() {
    if (fs.existsSync(URL_MAP_PATH)) {
        urlMap = JSON.parse(fs.readFileSync(URL_MAP_PATH, 'utf8'));
        for (const category in urlMap) {
            for (const section in urlMap[category]) {
                discoveredUrls.add(urlMap[category][section]);
            }
        }
    }
}

function saveUrlMap() {
    fs.writeFileSync(URL_MAP_PATH, JSON.stringify(urlMap, null, 2));
}

function isUrlDiscovered(url) {
    return discoveredUrls.has(url);
}

function addDiscoveredUrl(category, section, url) {
    if (!urlMap[category]) urlMap[category] = {};
    urlMap[category][section] = url;
    discoveredUrls.add(url);
    saveUrlMap();
}

// FIX 1: Determine category from URL
function getCategoryFromUrl(url) {
    if (url.includes('brand-information')) return 'Brand Information & Requirements';
    if (url.includes('restaurant-openings')) return 'Restaurant Openings & Remodels';
    if (url.includes('restaurant-operations')) return 'Restaurant Operations';
    if (url.includes('additional-resources')) return 'Additional Resources';
    if (url.includes('january-2026-changes-list') || url.includes('changes-list')) return 'Changes List';
    if (url.includes('legal-notice')) return 'Legal Notice';
    return 'Unknown';
}

// INSTANT NOTION WRITE - no queuing
async function writeToNotion(pageData) {
    try {
        // HASHING: Generate MD5 hash of content
        const contentHash = crypto.createHash('md5').update(pageData.content).digest('hex');
        
        // Check if exists
        let existingPage = null;
        try {
            const response = await fetch('https://api.notion.com/v1/data_sources/387be321-f648-47f3-bc26-8169de6065d8/query', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${NOTION_API_KEY}`,
                    'Notion-Version': '2025-09-03',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filter: { property: 'HierarchyPath', rich_text: { equals: pageData.hierarchyPath } }
                })
            });
            
            const data = await response.json();
            if (data.results && data.results.length > 0) {
                existingPage = data.results[0];
            }
        } catch (e) { }
        
        // FIX 1: Determine category from URL
        const category = getCategoryFromUrl(pageData.sourceURL);
        
        const properties = {
            'Title': { title: [{ text: { content: pageData.title } }] },
            'Category': { select: { name: category } },
            'Section': { rich_text: [{ text: { content: pageData.section || '' } }] },
            'Content': { rich_text: [{ text: { content: (pageData.content || '').substring(0, 2000) } }] },
            'ContentHash': { rich_text: [{ text: { content: contentHash } }] },
            'HierarchyPath': { rich_text: [{ text: { content: pageData.hierarchyPath } }] },
            'HierarchyLevel': { select: { name: pageData.hierarchyLevel } },
            'SourceURL': { rich_text: [{ text: { content: pageData.sourceURL } }] },
            'ScrapedDate': { date: { start: pageData.scrapedDate } },
            'Status': { select: { name: 'Scraped' } }
        };
        
        if (pageData.parentSection) properties['ParentSection'] = { rich_text: [{ text: { content: pageData.parentSection } }] };
        if (pageData.subCategory1) properties['SubCategory1'] = { rich_text: [{ text: { content: pageData.subCategory1 } }] };
        if (pageData.subCategory2) properties['SubCategory2'] = { rich_text: [{ text: { content: pageData.subCategory2 } }] };
        if (pageData.subCategory3) properties['SubCategory3'] = { rich_text: [{ text: { content: pageData.subCategory3 } }] };
        
        let notionResponse;
        if (existingPage) {
            notionResponse = await fetch(`https://api.notion.com/v1/pages/${existingPage.id}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${NOTION_API_KEY}`,
                    'Notion-Version': '2025-09-03',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ properties })
            });
        } else {
            notionResponse = await fetch('https://api.notion.com/v1/pages', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${NOTION_API_KEY}`,
                    'Notion-Version': '2025-09-03',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    parent: { database_id: SUBWAY_DATABASE_ID },
                    properties
                })
            });
        }
        
        if (!notionResponse.ok) {
            const errorData = await notionResponse.json();
            throw new Error(`Notion API error: ${errorData.message || notionResponse.statusText}`);
        }
        
        totalWrites++;
        
        // Rate limit: 3 requests per second
        await new Promise(resolve => setTimeout(resolve, 350));
        
    } catch (error) {
        console.error(`  ✗ NOTION WRITE FAILED: ${pageData.hierarchyPath} - ${error.message}`);
        throw error;
    }
}

async function downloadImage(page, url, filepath) {
    try {
        const response = await page.context().request.get(url);
        const buffer = await response.body();
        fs.writeFileSync(filepath, buffer);
        return filepath;
    } catch (error) {
        throw new Error(`Failed to download image: ${error.message}`);
    }
}

// REMOVE MARKDOWN ARTIFACTS
function cleanContent(markdown) {
    return markdown
        .split('\n')
        .filter(line => {
            const trimmed = line.trim();
            
            // Skip empty lines
            if (!trimmed) return false;
            
            // Remove prev/next navigation
            if (trimmed.startsWith('* [Prev]') || trimmed.startsWith('* [Next]')) return false;
            
            // Remove table artifacts
            if (trimmed === '|' || trimmed.match(/^\|[\s-]+\|$/)) return false;
            if (trimmed.match(/^\|[-|\s]+$/)) return false;
            
            // Remove UUID anchors
            if (trimmed.includes('#UUID-')) return false;
            
            // Remove bracket artifacts
            if (trimmed === '[' || trimmed === ']') return false;
            
            // Remove "No results found"
            if (trimmed.startsWith('No results found')) return false;
            
            // Remove internal relative links: [text](relative/path) or [text](relative/path "anchor")
            // Keep external links: [text](https://...)
            if (trimmed.match(/^\[.*\]\([^h][^t][^t][^p].*\)$/)) return false;
            if (trimmed.match(/^\[.*\]\(\.\.\/.*\)$/)) return false;
            if (trimmed.match(/^\[.*\]\(\.\/.*\)$/)) return false;
            if (trimmed.match(/^\[.*\]\(\/.*\)$/)) return false;
            
            return true;
        })
        .join('\n')
        .replace(/\n\n\n+/g, '\n\n')
        .trim();
}

// COLLAPSED SECTIONS FIX
async function expandCollapsedSections(page) {
    try {
        // Expand all collapsed sections at once using JavaScript
        const expandedCount = await page.evaluate(() => {
            let count = 0;
            
            // Expand details elements
            document.querySelectorAll('details:not([open])').forEach(el => {
                el.setAttribute('open', '');
                count++;
            });
            
            // Click elements with aria-expanded="false"
            document.querySelectorAll('[aria-expanded="false"]').forEach(el => {
                try {
                    el.click();
                    count++;
                } catch(e) {}
            });
            
            return count;
        });
        
        console.log(`    Expanded ${expandedCount} collapsed sections`);
        
        if (expandedCount > 0) {
            await page.waitForTimeout(1000); // Wait for content to load
        }
    } catch (error) {
        console.log(`    Warning: Could not expand collapsed sections - ${error.message}`);
    }
}

async function extractChildLinks(page, currentUrl) {
    const result = await page.evaluate((urlStr) => {
        const childLinks = [];
        
        const urlParts = urlStr.split('/');
        const currentPageFile = urlParts[urlParts.length - 1];
        const currentPageName = currentPageFile.replace('.html', '');
        
        const allLists = document.querySelectorAll('ul, ol');
        
        for (const list of allLists) {
            const links = list.querySelectorAll('a');
            if (links.length === 0 || links.length > 50) continue;
            
            const listChildLinks = [];
            
            Array.from(links).forEach(link => {
                const href = link.getAttribute('href');
                const text = link.textContent.trim();
                
                if (href && text && text.length < 100 && text.length > 0) {
                    if (href.includes('/' + currentPageName + '/')) {
                        const isAnchor = href.startsWith('#');
                        if (!isAnchor) {
                            listChildLinks.push({
                                text: text,
                                href: href,
                                isAnchor: false
                            });
                        }
                    }
                }
            });
            
            if (listChildLinks.length > 0) {
                return { childLinks: listChildLinks, found: true };
            }
        }
        
        return { childLinks: [], found: false };
    }, currentUrl);
    
    return result.childLinks;
}

async function scrapeContent(page) {
    console.log('    Waiting for page to load...');
    await page.waitForLoadState('networkidle').catch(() => console.log('    Network idle timeout'));
    
    console.log('    Expanding collapsed sections...');
    // Expand collapsed sections
    await expandCollapsedSections(page);
    
    console.log('    Extracting content from page...');
    const result = await page.evaluate(() => {
        let contentArea = document.querySelector('.topic-body');
        if (!contentArea || !contentArea.innerHTML.trim()) {
            contentArea = document.querySelector('.topic-content');
        }
        if (!contentArea || !contentArea.innerHTML.trim()) {
            contentArea = document.querySelector('[role="main"]');
        }
        
        if (!contentArea) return { html: '', images: [] };
        
        const excludeKeywords = ['nav', 'sidebar', 'footer', 'header', 'breadcrumb', 'pagination', 'combo', 'newsletter', 'related'];
        excludeKeywords.forEach(keyword => {
            contentArea.querySelectorAll(`[class*="${keyword}"]`).forEach(el => el.remove());
        });
        
        contentArea.querySelectorAll('*').forEach(el => {
            const text = el.innerText?.trim();
            if (text === 'Prev' || text === 'Next') {
                el.remove();
            }
        });
        
        contentArea.querySelectorAll('a').forEach(link => {
            const text = link.textContent.trim();
            if (text === 'Prev' || text === 'Next') {
                link.remove();
            }
        });
        
        const images = Array.from(contentArea.querySelectorAll('img')).map((img, index) => ({
            src: img.src,
            alt: img.alt || '',
            index: index + 1
        }));
        
        return {
            html: contentArea.innerHTML,
            images: images
        };
    });
    
    return result;
}

async function scrapePage(page, pageInfo, today, indent = '') {
    try {
        console.log(`${indent}→ Scraping: ${pageInfo.hierarchyPath}`);
        console.log(`${indent}  URL: ${pageInfo.url}`);
        
        await page.goto(pageInfo.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        const result = await scrapeContent(page);
        
        if (!result.html || result.html.trim().length === 0) {
            console.log(`${indent}  SKIPPED: ${pageInfo.hierarchyPath} - empty content`);
            return;
        }
        
        let content = turndownService.turndown(result.html);
        content = cleanContent(content);
        
        let imageCount = 0;
        if (result.images.length > 0) {
            const imageSection = ['\n\nIMAGES'];
            
            for (const img of result.images) {
                try {
                    const categorySlug = pageInfo.category.toLowerCase().replace(/\s+/g, '-').replace(/[®&]/g, '');
                    const titleSlug = pageInfo.title.toLowerCase().replace(/\s+/g, '-').replace(/[®&]/g, '');
                    const ext = path.extname(img.src) || '.jpg';
                    const filename = `${categorySlug}-${titleSlug}-${img.index}${ext}`;
                    const filepath = path.join(ASSETS_DIR, filename);
                    
                    await downloadImage(page, img.src, filepath);
                    imageSection.push(`Local: ${filepath}`);
                    imageSection.push(`Source: ${img.src}`);
                    imageCount++;
                } catch (err) {
                    // Ignore image download errors
                }
            }
            
            content += imageSection.join('\n');
        }
        
        const pageData = {
            title: pageInfo.title,
            category: pageInfo.category,
            section: pageInfo.section,
            parentSection: pageInfo.parentSection,
            subCategory1: pageInfo.subCategory1,
            subCategory2: pageInfo.subCategory2,
            subCategory3: pageInfo.subCategory3,
            hierarchyLevel: pageInfo.hierarchyLevel,
            hierarchyPath: pageInfo.hierarchyPath,
            content: content,
            sourceURL: pageInfo.url,
            scrapedDate: today
        };
        
        // INSTANT WRITE - no queuing
        await writeToNotion(pageData);
        
        // VERIFY SUCCESS
        console.log(`${indent}  SUCCESS: ${pageData.hierarchyPath} - ${content.length} chars - saved to Notion`);
        
        // UNIVERSAL CHILD PAGE DISCOVERY
        const childLinks = await extractChildLinks(page, pageInfo.url);
        
        if (childLinks.length > 0) {
            console.log(`${indent}  Found ${childLinks.length} child page(s)`);
            
            for (const childLink of childLinks) {
                try {
                    let childUrl = childLink.href;
                    if (childUrl.startsWith('../')) {
                        const currentUrl = new URL(pageInfo.url);
                        childUrl = new URL(childUrl, currentUrl).href;
                    } else if (childUrl.startsWith('/NA/en/')) {
                        childUrl = 'https://cloudopsmanual.subway.com' + childUrl;
                    } else if (childUrl.startsWith('./')) {
                        const currentUrl = new URL(pageInfo.url);
                        childUrl = new URL(childUrl, currentUrl).href;
                    } else if (!childUrl.startsWith('https://')) {
                        const currentUrl = new URL(pageInfo.url);
                        childUrl = new URL(childUrl, currentUrl).href;
                    }
                    
                    if (isUrlDiscovered(childUrl)) {
                        console.log(`${indent}    SKIPPED: ${childLink.text} (already in URL map)`);
                        continue;
                    }
                    
                    addDiscoveredUrl(pageInfo.category, childLink.text, childUrl);
                    console.log(`${indent}    ✓ Added to URL map: ${childLink.text}`);
                    
                    let nextLevel, nextSubCat1, nextSubCat2, nextSubCat3;
                    if (pageInfo.hierarchyLevel === 'Section') {
                        nextLevel = 'SubCategory1';
                        nextSubCat1 = childLink.text;
                        nextSubCat2 = null;
                        nextSubCat3 = null;
                    } else if (pageInfo.hierarchyLevel === 'SubCategory1') {
                        nextLevel = 'SubCategory2';
                        nextSubCat1 = pageInfo.subCategory1;
                        nextSubCat2 = childLink.text;
                        nextSubCat3 = null;
                    } else if (pageInfo.hierarchyLevel === 'SubCategory2') {
                        nextLevel = 'SubCategory3';
                        nextSubCat1 = pageInfo.subCategory1;
                        nextSubCat2 = pageInfo.subCategory2;
                        nextSubCat3 = childLink.text;
                    } else {
                        console.log(`${indent}      SKIPPED: ${childLink.text} (max hierarchy depth)`);
                        continue;
                    }
                    
                    const childPageInfo = {
                        title: childLink.text,
                        category: pageInfo.category,
                        section: pageInfo.section,
                        parentSection: pageInfo.title,
                        subCategory1: nextSubCat1,
                        subCategory2: nextSubCat2,
                        subCategory3: nextSubCat3,
                        hierarchyLevel: nextLevel,
                        hierarchyPath: `${pageInfo.hierarchyPath} > ${childLink.text}`,
                        url: childUrl
                    };
                    
                    await scrapePage(page, childPageInfo, today, indent + '  ');
                    
                } catch (err) {
                    console.log(`${indent}      SKIPPED: ${childLink.text} - ${err.message}`);
                }
            }
        }
        
    } catch (error) {
        console.log(`${indent}  SKIPPED: ${pageInfo.hierarchyPath} - ${error.message}`);
    }
}

async function main() {
    console.log('========================================');
    console.log('  SUBWAY OPERATIONS MANUAL SCRAPER');
    console.log('  (Headless + Instant Writes)');
    console.log('========================================\n');
    
    // SPEED FIX: headless true
    console.log('[Step 1] Launching browser (headless)...');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    
    console.log('[Step 2] Navigating directly to manual...');
    await page.goto('https://cloudopsmanual.subway.com/NA/?lang=en');
    await page.waitForTimeout(3000);
    
    console.log('[Step 3] Handling login if needed...');
    if (page.url().includes('login') || page.url().includes('signin') || page.url().includes('subid')) {
        await page.locator('input[type="email"], #signInName').first().fill(SUBWAY_EMAIL);
        await page.locator('input[type="password"], #password').first().fill(SUBWAY_PASSWORD);
        await page.locator('button[type="submit"], #next').first().click();
        await page.waitForTimeout(5000);
    }
    
    console.log('[Step 4] Loading URL map...');
    loadUrlMap();
    console.log(`  Loaded ${Object.keys(urlMap).length} categories`);
    
    console.log('[Step 5] Starting scraping with instant Notion writes...\n');
    const today = new Date().toISOString().split('T')[0];
    
    for (const [category, sections] of Object.entries(urlMap)) {
        console.log(`\n=== CATEGORY: ${category} ===`);
        
        for (const [section, url] of Object.entries(sections)) {
            const pageInfo = {
                title: section,
                category: category,
                section: section,
                parentSection: null,
                subCategory1: null,
                subCategory2: null,
                subCategory3: null,
                hierarchyLevel: 'Section',
                hierarchyPath: `${category} > ${section}`,
                url: url
            };
            
            await scrapePage(page, pageInfo, today);
        }
    }
    
    await browser.close();
    
    console.log('\n========================================');
    console.log('===  SCRAPING COMPLETE  ===');
    console.log('========================================');
    console.log(`✓ Total Notion writes: ${totalWrites}`);
    console.log(`✓ Total URLs discovered: ${discoveredUrls.size}`);
    console.log('========================================\n');
    
    // AFTER FULL SCRAPE: Run change detector
    console.log('[Post-Scrape] Running change detector...\n');
    const { exec } = require('child_process');
    const changeDetectorPath = path.join(__dirname, 'subway-change-detector.js');
    
    exec(`node ${changeDetectorPath}`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Change detector error: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`Change detector stderr: ${stderr}`);
        }
        console.log(stdout);
        console.log('✓ Change detector completed\n');
    });
}

main().catch(error => {
    console.error('FATAL ERROR:', error);
    process.exit(1);
});
