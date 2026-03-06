#!/usr/bin/env node

const https = require('https');
const fs = require('fs');

function loadEnv() {
  const envPath = process.env.HOME + '/.openclaw/.env';
  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = {};
  
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      env[key] = value;
    }
  });
  
  return env;
}

const env = loadEnv();
const NOTION_API_KEY = env.NOTION_API_KEY;
const DATABASE_ID = "f20d4d1a59c34a54aa22b3adaf845764";

async function queryDatabase(cursor = undefined) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      start_cursor: cursor,
      page_size: 100
    });

    const options = {
      hostname: 'api.notion.com',
      path: `/v1/databases/${DATABASE_ID}/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(`API Error: ${parsed.message || data}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function getAllPages() {
  let allResults = [];
  let cursor = undefined;
  let hasMore = true;

  while (hasMore) {
    const response = await queryDatabase(cursor);
    allResults = allResults.concat(response.results);
    hasMore = response.has_more;
    cursor = response.next_cursor;
  }

  return allResults;
}

function extractValue(property) {
  if (!property) return null;
  
  switch (property.type) {
    case 'title':
      return property.title[0]?.plain_text || '';
    case 'rich_text':
      return property.rich_text[0]?.plain_text || '';
    case 'number':
      return property.number;
    case 'select':
      return property.select?.name || null;
    case 'date':
      return property.date?.start || null;
    default:
      return null;
  }
}

async function analyzeExpenses() {
  try {
    console.log('Querying CompanyExpenses database...\n');
    
    const pages = await getAllPages();
    
    // Parse all records
    const records = pages.map(page => {
      const props = page.properties;
      return {
        vendor: extractValue(props.Vendor),
        amount: extractValue(props.Amount),
        category: extractValue(props.Category),
        expenseDate: extractValue(props.Date),
        source: extractValue(props.Source),
        created: page.created_time,
      };
    });

    console.log(`Total records found: ${records.length}\n`);

    // 1. February 2026 total
    const feb2026 = records.filter(r => {
      if (!r.expenseDate) return false;
      const date = new Date(r.expenseDate);
      return date.getFullYear() === 2026 && date.getMonth() === 1;
    });
    const feb2026Total = feb2026.reduce((sum, r) => sum + (r.amount || 0), 0);
    console.log(`1. February 2026 total: $${feb2026Total.toFixed(2)} (${feb2026.length} invoices)`);

    // 2. Vendor with highest total spend
    const vendorTotals = {};
    records.forEach(r => {
      if (r.vendor && r.amount) {
        vendorTotals[r.vendor] = (vendorTotals[r.vendor] || 0) + r.amount;
      }
    });
    const topVendor = Object.entries(vendorTotals).sort((a, b) => b[1] - a[1])[0];
    console.log(`2. Highest spend vendor: ${topVendor ? `${topVendor[0]} ($${topVendor[1].toFixed(2)})` : 'None'}`);

    // 3. Upwork invoices
    const upworkInvoices = records.filter(r => r.vendor?.toLowerCase().includes('upwork'));
    const upworkTotal = upworkInvoices.reduce((sum, r) => sum + (r.amount || 0), 0);
    console.log(`3. Upwork: ${upworkInvoices.length} invoices, $${upworkTotal.toFixed(2)} total`);

    // 4. Category with most entries
    const categoryCounts = {};
    records.forEach(r => {
      if (r.category) {
        categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;
      }
    });
    const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];
    console.log(`4. Most common category: ${topCategory ? `${topCategory[0]} (${topCategory[1]} entries)` : 'None'}`);

    // 5. Missing amounts
    const missingAmount = records.filter(r => r.amount === null || r.amount === undefined);
    console.log(`5. Missing Amount: ${missingAmount.length} rows${missingAmount.length > 0 ? ` (${missingAmount.slice(0, 5).map(r => r.vendor).join(', ')}${missingAmount.length > 5 ? '...' : ''})` : ''}`);

    // 6. Most recent invoice
    const sortedByDate = records
      .filter(r => r.expenseDate)
      .sort((a, b) => new Date(b.expenseDate) - new Date(a.expenseDate));
    const mostRecent = sortedByDate[0];
    console.log(`6. Most recent: ${mostRecent ? `${mostRecent.vendor} on ${mostRecent.expenseDate} for $${(mostRecent.amount || 0).toFixed(2)}` : 'None'}`);

    // 7. Source breakdown
    const sourceCounts = {};
    records.forEach(r => {
      const source = r.source || 'Unknown';
      sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    });
    console.log(`7. Source breakdown: ${Object.entries(sourceCounts).map(([k, v]) => `${k}: ${v}`).join(', ')}`);

    // 8. March 2026 total
    const mar2026 = records.filter(r => {
      if (!r.expenseDate) return false;
      const date = new Date(r.expenseDate);
      return date.getFullYear() === 2026 && date.getMonth() === 2;
    });
    const mar2026Total = mar2026.reduce((sum, r) => sum + (r.amount || 0), 0);
    console.log(`8. March 2026 total so far: $${mar2026Total.toFixed(2)} (${mar2026.length} invoices)`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

analyzeExpenses();
