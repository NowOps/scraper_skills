#!/usr/bin/env node

const { Client } = require("@notionhq/client");
const https = require('https');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = "f20d4d1a59c34a54aa22b3adaf845764";
const CHECKPOINT_FILE = path.join(__dirname, '../logs/invoice-scan-checkpoint.json');
const INVOICE_DIR = path.join(__dirname, '../assets/invoices');
const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 2000;

// Ensure invoice directory exists
if (!fs.existsSync(INVOICE_DIR)) {
  fs.mkdirSync(INVOICE_DIR, { recursive: true });
}

// Load environment variables
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
const TENANT_ID = env.O365_TENANT_ID;
const CLIENT_ID = env.O365_CLIENT_ID;
const CLIENT_SECRET = env.O365_CLIENT_SECRET;
const MAILBOX_EMAIL = env.O365_MAILBOX_EMAIL;
const NOTION_API_KEY = env.NOTION_API_KEY;

const INCLUDE_KEYWORDS = [
  "invoice", "receipt", "payment", "charge", "billing", 
  "subscription", "order confirmation", "statement", "transaction", 
  "paid", "purchase", "amount due", "auto-recharge", "renewal"
];

const EXCLUDE_KEYWORDS = [
  "verified", "verification", "identity", "scam", "alert", 
  "job posted", "welcome", "added to", "help:", "newsletter", 
  "unsubscribe", "tracking", "shipment", "marketing", "promotional",
  // Failed transactions
  "billing method declined", "payment declined", "payment failed", 
  "payment unsuccessful", "charge failed", "card declined", 
  "transaction failed", "unable to process", "declined",
  // Security/verification emails
  "verify your email", "confirm your email", "reset your password", 
  "security alert", "sign in attempt", "new device"
];

// Domain-based category mapping (root domains only)
const DOMAIN_CATEGORIES = {
  "upwork.com": "Upwork",
  "google.com": "Google",
  "microsoft.com": "Microsoft",
  "openai.com": "AI",
  "anthropic.com": "AI",
  "github.com": "Software",
  "vercel.com": "Software",
  "cloudflare.com": "Software",
  "notion.so": "Software",
  "amazonaws.com": "Software",
  "digitalocean.com": "Software",
  "apple.com": "Software",
  "icloud.com": "Software",
  "doordash.com": "Food",
  "ubereats.com": "Food",
  "skipthedishes.com": "Food",
  "rbc.com": "Banking",
  "td.com": "Banking",
  "bmo.com": "Banking",
  "scotiabank.com": "Banking",
  "cibc.com": "Banking",
  "royalbank.com": "Banking",
  "canada.ca": "Tax",
  "cra-arc.gc.ca": "Tax",
  "airliquide.com": "Supplies",
  "tenfeetsports.com": "Other",
  "strataca.com": "Other",
  "papaplumbing.com": "Maintenance"
};

// Microsoft Graph API helper
async function getAccessToken() {
  const tokenUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  return new Promise((resolve, reject) => {
    const req = https.request(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            resolve(parsed.access_token);
          } else {
            reject(new Error('No access token in response'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(params.toString());
    req.end();
  });
}

async function graphRequest(accessToken, endpoint) {
  const url = `https://graph.microsoft.com/v1.0/users/${MAILBOX_EMAIL}/${endpoint}`;
  
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function notionRequest(method, path, body = null) {
  const url = `https://api.notion.com/v1${path}`;
  const options = {
    method: method,
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function loadCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading checkpoint:', e.message);
  }
  
  return {
    "Inbox": { "lastSkip": 0, "totalScanned": 0, "done": false },
    "FwdGmail": { "lastSkip": 0, "totalScanned": 0, "done": false },
    "FwdICloud": { "lastSkip": 0, "totalScanned": 0, "done": false }
  };
}

function saveCheckpoint(checkpoint) {
  try {
    const logsDir = path.dirname(CHECKPOINT_FILE);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
  } catch (e) {
    console.error('Error saving checkpoint:', e.message);
  }
}

function qualifiesAsInvoice(subject, fromEmail) {
  const subjectLower = (subject || '').toLowerCase();
  
  // FIX 2: Skip Upwork billing report emails (keep only payment confirmations)
  const rootDomain = extractRootDomain(fromEmail || '');
  if (rootDomain === 'upwork.com') {
    if (subjectLower.includes('billing report') || subjectLower.includes('weekly billing')) {
      return false; // Skip timesheet alerts
    }
  }
  
  // Check exclude keywords first
  const excluded = EXCLUDE_KEYWORDS.some(keyword => 
    subjectLower.includes(keyword.toLowerCase())
  );
  if (excluded) return false;
  
  // Check include keywords
  const included = INCLUDE_KEYWORDS.some(keyword => 
    subjectLower.includes(keyword.toLowerCase())
  );
  
  return included;
}

function extractRootDomain(email) {
  if (!email) return null;
  
  const domain = email.split('@')[1] || '';
  const parts = domain.split('.');
  
  // Handle common patterns:
  // example.com -> example.com
  // subdomain.example.com -> example.com
  // subdomain.example.co.uk -> example.co.uk
  
  if (parts.length >= 2) {
    // Check for known TLDs that need two parts (co.uk, com.au, etc.)
    const twoPartTLDs = ['co.uk', 'com.au', 'co.nz', 'co.za'];
    const lastTwo = parts.slice(-2).join('.');
    
    if (twoPartTLDs.includes(lastTwo) && parts.length >= 3) {
      return parts.slice(-3).join('.');
    }
    
    // Default: return last two parts
    return parts.slice(-2).join('.');
  }
  
  return domain;
}

function extractVendor(fromEmail, displayName) {
  if (!fromEmail) return { name: "Unknown", category: "Other" };
  
  // Extract root domain
  const rootDomain = extractRootDomain(fromEmail);
  
  // Get category from domain mapping (purely domain-based, no keywords)
  const category = DOMAIN_CATEGORIES[rootDomain] || "Other";
  
  // Extract vendor name
  let vendorName = "Unknown";
  if (displayName && displayName !== fromEmail) {
    const cleaned = displayName.split(/[<(@]/)[0].trim();
    if (cleaned.length > 0 && cleaned.length < 50) {
      vendorName = cleaned;
    }
  } else {
    // Fall back to domain name
    const domainParts = (rootDomain || '').split('.');
    const mainDomain = domainParts[0] || 'Unknown';
    vendorName = mainDomain.charAt(0).toUpperCase() + mainDomain.slice(1);
  }
  
  return { name: vendorName, category: category };
}

function extractAmount(text) {
  if (!text) return null;
  
  // Find all dollar amounts with various patterns
  const patterns = [
    /\$[\d,]+\.?\d*/g,
    /CAD\s+[\d,]+\.?\d*/gi,
    /USD\s+[\d,]+\.?\d*/gi,
    /[\d,]+\.?\d*\s+CAD/gi,
    /[\d,]+\.?\d*\s+USD/gi,
    /Total:\s*\$?[\d,]+\.?\d*/gi,
    /Total\s+CAD\s+\$?[\d,]+\.?\d*/gi,
    /Total\s+USD\s+\$?[\d,]+\.?\d*/gi,
    /Amount\s+Due:\s*\$?[\d,]+\.?\d*/gi,
    /Balance\s+Due:\s*\$?[\d,]+\.?\d*/gi,
    /Amount\s+Owing:\s*\$?[\d,]+\.?\d*/gi,
    /Grand\s+Total:\s*\$?[\d,]+\.?\d*/gi,
    /You\s+owe:\s*\$?[\d,]+\.?\d*/gi,
    /Charged:\s*\$?[\d,]+\.?\d*/gi,
    /Billed:\s*\$?[\d,]+\.?\d*/gi
  ];
  
  const matches = [];
  for (const pattern of patterns) {
    const found = text.match(pattern);
    if (found) {
      matches.push(...found);
    }
  }
  
  if (matches.length === 0) return null;
  
  // Convert to numbers and find largest over $1.00
  const amounts = matches.map(m => {
    const numStr = m.replace(/[^0-9.]/g, '');
    return parseFloat(numStr);
  }).filter(n => !isNaN(n) && n > 1.00); // Only amounts over $1.00
  
  if (amounts.length === 0) return null;
  
  const largest = Math.max(...amounts);
  return largest;
}

function extractCurrency(text) {
  if (!text) return "USD";
  
  const textLower = text.toLowerCase();
  if (textLower.includes('cad') || textLower.includes('canadian')) {
    return "CAD";
  }
  
  return "USD";
}

function isValidInvoiceNumber(value) {
  if (!value || value.length < 6 || value.length > 20) return false;
  
  // Must start with digit OR start with INV/ORD/TXN/REF/RCP
  const startsWithDigit = /^[0-9]/.test(value);
  const startsWithPrefix = /^(INV|ORD|TXN|REF|RCP)/i.test(value);
  
  if (!startsWithDigit && !startsWithPrefix) return false;
  
  // Must NOT be a hex color code (exactly 6 hex chars)
  const isHexColor = /^[A-F0-9]{6}$/i.test(value);
  if (isHexColor) return false;
  
  return true;
}

function extractUpworkReferenceId(text) {
  if (!text) return null;
  
  // Pattern 1: "Reference ID" followed by whitespace and number
  const pattern1 = /Reference\s+ID\s*:?\s*(\d{9})/i;
  const match1 = text.match(pattern1);
  if (match1) return match1[1];
  
  // Pattern 2: "reference id" case insensitive
  const pattern2 = /reference\s+id\s*:?\s*(\d{9})/i;
  const match2 = text.match(pattern2);
  if (match2) return match2[1];
  
  // Pattern 3: Standalone 9 digit number near "reference" or "transaction"
  const pattern3 = /(?:reference|transaction)[^\d]{0,50}(\d{9})/i;
  const match3 = text.match(pattern3);
  if (match3) return match3[1];
  
  // Pattern 4: Just find a 9-digit number (last resort)
  const pattern4 = /\b(\d{9})\b/;
  const match4 = text.match(pattern4);
  if (match4) return match4[1];
  
  return null;
}

function extractInvoiceNumber(text, fromEmail) {
  if (!text) return null;
  
  // Special handling for Upwork: extract Reference ID from email body
  const rootDomain = extractRootDomain(fromEmail || '');
  if (rootDomain === 'upwork.com') {
    const refId = extractUpworkReferenceId(text);
    if (refId) return refId;
  }
  
  const patterns = [
    /Invoice\s*#\s*([A-Z0-9-]+)/i,
    /Invoice\s*Number\s*:?\s*([A-Z0-9-]+)/i,
    /Order\s*#\s*([A-Z0-9-]+)/i,
    /Transaction\s*ID\s*:?\s*([A-Z0-9-]+)/i,
    /Receipt\s*#\s*([A-Z0-9-]+)/i,
    /Reference\s+ID\s*:?\s*([A-Z0-9-]+)/i,
    /#([0-9]{6,})/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && isValidInvoiceNumber(match[1])) {
      return match[1];
    }
  }
  
  return null;
}

async function getMessageBody(accessToken, messageId) {
  try {
    const response = await graphRequest(accessToken, `messages/${messageId}?$select=body`);
    return response.body?.content || '';
  } catch (error) {
    console.error(`   Error fetching body for message ${messageId}:`, error.message);
    return '';
  }
}

async function getPDFAttachments(accessToken, messageId) {
  try {
    const response = await graphRequest(accessToken, `messages/${messageId}/attachments`);
    
    if (!response.value || response.value.length === 0) {
      return [];
    }
    
    const pdfAttachments = response.value.filter(att => 
      att.contentType?.includes('pdf') || att.name?.toLowerCase().endsWith('.pdf')
    );
    
    return pdfAttachments;
  } catch (error) {
    console.error(`   Error fetching attachments for message ${messageId}:`, error.message);
    return [];
  }
}

async function parsePDF(pdfBuffer) {
  try {
    const data = await pdf(pdfBuffer);
    return data.text;
  } catch (error) {
    console.error(`   PDF parse error: ${error.message}`);
    return null;
  }
}

function extractFieldsFromPDF(pdfText, fromEmail) {
  const fields = {
    invoiceNumber: null,
    amount: null,
    currency: null,
    date: null
  };
  
  if (!pdfText) return fields;
  
  // Invoice Number
  const invoicePatterns = [
    /INVOICE\s*#\s*(\d+)/i,
    /Invoice\s*No\.?\s*:?\s*(\d+)/i,
    /Invoice\s*Number\s*:?\s*(\d+)/i,
    /Ref(?:erence)?\s*#?\s*:?\s*(\d+)/i
  ];
  
  for (const pattern of invoicePatterns) {
    const match = pdfText.match(pattern);
    if (match && match[1].length >= 6 && match[1].length <= 20) {
      fields.invoiceNumber = match[1];
      break;
    }
  }
  
  // Amount (look for total lines)
  const amountPatterns = [
    /Total\s+CAD\s+\$\s*([\d,]+\.?\d*)/i,
    /Total\s+USD\s+\$\s*([\d,]+\.?\d*)/i,
    /Grand\s+Total\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
    /Amount\s+Due\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
    /Balance\s+Due\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
    /Total\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
    /Sub\s*Total\s*:?\s*\$?\s*([\d,]+\.?\d*)/i
  ];
  
  const amounts = [];
  for (const pattern of amountPatterns) {
    const match = pdfText.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (amount > 1.00) {
        amounts.push(amount);
      }
    }
  }
  
  if (amounts.length > 0) {
    fields.amount = Math.max(...amounts);
  }
  
  // Currency
  if (pdfText.includes('CAD') || pdfText.includes('Canadian')) {
    fields.currency = 'CAD';
  } else if (pdfText.includes('USD')) {
    fields.currency = 'USD';
  } else {
    fields.currency = 'CAD'; // Default
  }
  
  // Date
  const datePatterns = [
    /Invoice\s+Date\s*:?\s*(\d{2}-[A-Z]{3}-\d{2,4})/i,
    /Date\s*:?\s*(\d{2}\/\d{2}\/\d{4})/,
    /Date\s*:?\s*(\d{4}-\d{2}-\d{2})/,
    /(\d{2}-[A-Z]{3}-\d{4})/i
  ];
  
  for (const pattern of datePatterns) {
    const match = pdfText.match(pattern);
    if (match) {
      fields.date = match[1];
      break;
    }
  }
  
  return fields;
}

function parseDateForNotion(dateStr) {
  if (!dateStr) return null;
  
  // Handle format: 01-MAR-26 or 01-MAR-2026
  const match = dateStr.match(/(\d{2})-([A-Z]{3})-(\d{2,4})/i);
  if (match) {
    const day = match[1];
    const monthMap = {
      'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
      'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
      'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
    };
    const month = monthMap[match[2].toUpperCase()];
    let year = match[3];
    if (year.length === 2) {
      year = '20' + year;
    }
    return `${year}-${month}-${day}`;
  }
  
  // Handle MM/DD/YYYY
  const match2 = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match2) {
    return `${match2[3]}-${match2[1]}-${match2[2]}`;
  }
  
  // Handle YYYY-MM-DD
  const match3 = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match3) {
    return dateStr;
  }
  
  return null;
}

function savePDF(pdfBuffer, vendor, invoiceNumber, date) {
  const sanitize = (str) => (str || 'unknown').replace(/[^a-z0-9.-]/gi, '_');
  const filename = `${sanitize(vendor)}-${sanitize(invoiceNumber)}-${sanitize(date)}.pdf`;
  const filepath = path.join(INVOICE_DIR, filename);
  
  fs.writeFileSync(filepath, pdfBuffer);
  return filepath;
}

async function extractInvoiceData(accessToken, message, sourceName) {
  const bodyPreview = message.bodyPreview || '';
  const subject = message.subject || '';
  
  // Fetch full body for better extraction
  const fullBody = await getMessageBody(accessToken, message.id);
  const fullText = `${subject} ${bodyPreview} ${fullBody}`;
  
  const displayName = message.from?.emailAddress?.name || '';
  const fromEmail = message.from?.emailAddress?.address || '';
  
  const vendor = extractVendor(fromEmail, displayName);
  let amount = extractAmount(fullText);
  let currency = amount ? extractCurrency(fullText) : null;
  let invoiceNumber = extractInvoiceNumber(fullText, fromEmail);
  let date = message.receivedDateTime?.split('T')[0] || new Date().toISOString().split('T')[0];
  let receiptLink = null;
  
  // If critical fields are missing, check for PDF attachments
  const needsPDF = !amount || !invoiceNumber;
  
  if (needsPDF && message.hasAttachments) {
    const pdfAttachments = await getPDFAttachments(accessToken, message.id);
    
    if (pdfAttachments.length > 0) {
      const pdfAttachment = pdfAttachments[0]; // Use first PDF
      
      try {
        // Download and parse PDF
        const pdfBuffer = Buffer.from(pdfAttachment.contentBytes, 'base64');
        const pdfText = await parsePDF(pdfBuffer);
        
        if (pdfText) {
          // Extract fields from PDF
          const pdfFields = extractFieldsFromPDF(pdfText, fromEmail);
          
          // Use PDF fields if they're better than what we have
          if (pdfFields.amount && !amount) {
            amount = pdfFields.amount;
          }
          
          if (pdfFields.currency && !currency) {
            currency = pdfFields.currency;
          }
          
          if (pdfFields.invoiceNumber && !invoiceNumber) {
            invoiceNumber = pdfFields.invoiceNumber;
          }
          
          if (pdfFields.date) {
            const parsedDate = parseDateForNotion(pdfFields.date);
            if (parsedDate) {
              date = parsedDate;
            }
          }
          
          // Save PDF locally
          const pdfPath = savePDF(pdfBuffer, vendor.name, invoiceNumber, date);
          receiptLink = `file://${pdfPath}`;
        }
      } catch (error) {
        console.error(`   Error processing PDF: ${error.message}`);
      }
    }
  }
  
  // FIX 2: Skip statement-only emails with no amount
  const subjectLower = subject.toLowerCase();
  const isStatementOnly = (
    subjectLower.includes('is now available') ||
    subjectLower.includes('estatement is ready') ||
    subjectLower.includes('statement is here') ||
    subjectLower.includes('financial statement is available')
  );
  
  if (isStatementOnly && !amount) {
    return null; // Skip this email
  }
  
  return {
    description: subject.substring(0, 2000),
    date: date,
    source: sourceName,
    vendor: vendor.name,
    category: vendor.category,
    amount: amount,
    currency: currency,
    invoiceNumber: invoiceNumber,
    receiptLink: receiptLink,
    notes: `From: ${fromEmail}`
  };
}

async function discoverFolders(accessToken) {
  const response = await graphRequest(accessToken, 'mailFolders');
  
  const targetFolders = [
    { name: "Inbox", displayNames: ["Inbox"], source: "Outlook", checkpointKey: "Inbox" },
    { name: "Gmail", displayNames: ["Fwrd — Gmail", "Fwd — Gmail", "Fwd - Gmail"], source: "Gmail", checkpointKey: "FwdGmail" },
    { name: "iCloud", displayNames: ["Fwrd — iCloud", "Fwd — iCloud", "Fwd - iCloud"], source: "iCloud", checkpointKey: "FwdICloud" }
  ];
  
  const foundFolders = [];
  
  for (const target of targetFolders) {
    const folder = response.value.find(f => target.displayNames.includes(f.displayName));
    if (folder) {
      foundFolders.push({
        id: folder.id,
        displayName: folder.displayName,
        source: target.source,
        checkpointKey: target.checkpointKey,
        totalItemCount: folder.totalItemCount
      });
    }
  }
  
  return foundFolders;
}

async function getAllExistingEntries() {
  try {
    let allEntries = new Map(); // Key: description+date+amount, Value: true
    let hasMore = true;
    let startCursor = undefined;
    
    while (hasMore) {
      const body = { page_size: 100 };
      if (startCursor) body.start_cursor = startCursor;
      
      const response = await notionRequest('POST', `/databases/${DATABASE_ID}/query`, body);
      
      for (const entry of (response.results || [])) {
        const description = entry.properties.Description?.title?.[0]?.text?.content || '';
        const date = entry.properties.Date?.date?.start || '';
        const amount = entry.properties.Amount?.number || 0;
        const vendor = entry.properties.Vendor?.rich_text?.[0]?.text?.content || '';
        
        // Create a unique key from description, date, amount, and vendor
        const key = `${description}|${date}|${amount}|${vendor}`.toLowerCase();
        allEntries.set(key, true);
      }
      
      hasMore = response.has_more || false;
      startCursor = response.next_cursor;
    }
    
    return allEntries;
  } catch (error) {
    console.error("Error getting existing entries:", error.message);
    return new Map();
  }
}

async function createExpenseEntry(data) {
  try {
    const properties = {
      "Description": {
        title: [{ text: { content: data.description } }]
      },
      "Source": {
        select: { name: data.source }
      },
      "Date": {
        date: { start: data.date }
      },
      "VerificationStatus": {
        select: { name: "Unverified" }
      },
      "Status": {
        select: { name: "Pending" }
      },
      "Vendor": {
        rich_text: [{ text: { content: data.vendor } }]
      },
      "Category": {
        select: { name: data.category }
      }
    };

    if (data.amount) {
      properties["Amount"] = { number: data.amount };
    }

    if (data.currency) {
      properties["Currency"] = { select: { name: data.currency } };
    }

    if (data.invoiceNumber) {
      properties["InvoiceNumber"] = {
        rich_text: [{ text: { content: data.invoiceNumber } }]
      };
    }

    if (data.notes) {
      properties["Notes"] = {
        rich_text: [{ text: { content: data.notes } }]
      };
    }

    if (data.receiptLink) {
      properties["ReceiptLink"] = {
        url: data.receiptLink
      };
    }

    const response = await notion.pages.create({
      parent: { database_id: DATABASE_ID },
      properties: properties
    });

    return response;
  } catch (error) {
    console.error("Error creating expense entry:", error.message);
    throw error;
  }
}

async function scanFolderBatch(accessToken, folder, skip, existingEntries) {
  try {
    const endpoint = `mailFolders/${folder.id}/messages?$top=${BATCH_SIZE}&$skip=${skip}&$orderby=receivedDateTime desc&$select=id,internetMessageId,subject,from,receivedDateTime,bodyPreview,hasAttachments`;
    const response = await graphRequest(accessToken, endpoint);
    
    if (!response || !response.value || response.value.length === 0) {
      return { scanned: 0, qualified: [], created: [] };
    }

    const qualified = [];
    
    for (const message of response.value) {
      const fromEmail = message.from?.emailAddress?.address || '';
      if (qualifiesAsInvoice(message.subject, fromEmail)) {
        qualified.push(message);
      }
    }
    
    const created = [];
    let skipped = 0;
    
    for (const message of qualified) {
      const data = await extractInvoiceData(accessToken, message, folder.source);
      
      // Skip if extraction returned null (statement-only email)
      if (!data) {
        skipped++;
        continue;
      }
      
      // Check for duplicates using description+date+amount+vendor
      const dupKey = `${data.description}|${data.date}|${data.amount || 0}|${data.vendor}`.toLowerCase();
      if (existingEntries.has(dupKey)) {
        skipped++;
        continue;
      }
      
      try {
        await createExpenseEntry(data);
        created.push(data);
        existingEntries.set(dupKey, true);
      } catch (error) {
        console.error(`   ❌ Failed: ${data.description} - ${error.message}`);
      }
    }
    
    return { scanned: response.value.length, qualified: qualified, created: created, skipped: skipped };
  } catch (error) {
    console.error(`Error scanning batch at skip ${skip}:`, error.message);
    return { scanned: 0, qualified: [], created: [], skipped: 0 };
  }
}

async function scanFolder(accessToken, folder, checkpoint, existingEntries) {
  const checkpointKey = folder.checkpointKey;
  
  if (checkpoint[checkpointKey].done) {
    console.log(`\n📧 ${folder.displayName} (${folder.source}) - Already complete, skipping`);
    return { scanned: 0, created: 0 };
  }
  
  console.log(`\n📧 Scanning ${folder.displayName} (${folder.source})...`);
  
  let skip = checkpoint[checkpointKey].lastSkip;
  let totalScanned = checkpoint[checkpointKey].totalScanned;
  let totalCreated = 0;
  let hasMore = true;
  
  while (hasMore) {
    const result = await scanFolderBatch(accessToken, folder, skip, existingEntries);
    
    if (result.scanned === 0) {
      hasMore = false;
      checkpoint[checkpointKey].done = true;
    } else {
      totalScanned += result.scanned;
      totalCreated += result.created.length;
      
      const amountSummary = result.created.length > 0
        ? result.created.map(r => `${r.vendor} ${r.amount ? `$${r.amount.toFixed(2)}` : 'no amount'}`).join(', ')
        : 'none';
      
      console.log(`   BATCH [${folder.displayName}] [skip ${skip}]: scanned ${result.scanned} - found ${result.qualified.length} invoices - created ${result.created.length} rows - ${amountSummary}`);
      
      skip += BATCH_SIZE;
      checkpoint[checkpointKey].lastSkip = skip;
      checkpoint[checkpointKey].totalScanned = totalScanned;
      
      saveCheckpoint(checkpoint);
      console.log(`   checkpoint saved`);
      
      // Delay between batches
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  
  return { scanned: totalScanned, created: totalCreated };
}

async function main() {
  console.log("🚀 Starting batched invoice scan with resume capability...");
  console.log(`📊 Database: ${DATABASE_ID}`);
  console.log(`📋 Checkpoint file: ${CHECKPOINT_FILE}`);
  console.log(`⚙️  Batch size: ${BATCH_SIZE}, Delay: ${BATCH_DELAY_MS}ms\n`);
  
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !MAILBOX_EMAIL) {
    console.error('❌ Error: Missing O365 credentials in ~/.openclaw/.env');
    process.exit(1);
  }
  
  // Load checkpoint
  const checkpoint = loadCheckpoint();
  console.log("📁 Checkpoint loaded:");
  console.log(`   Inbox: skip=${checkpoint.Inbox.lastSkip}, scanned=${checkpoint.Inbox.totalScanned}, done=${checkpoint.Inbox.done}`);
  console.log(`   FwdGmail: skip=${checkpoint.FwdGmail.lastSkip}, scanned=${checkpoint.FwdGmail.totalScanned}, done=${checkpoint.FwdGmail.done}`);
  console.log(`   FwdICloud: skip=${checkpoint.FwdICloud.lastSkip}, scanned=${checkpoint.FwdICloud.totalScanned}, done=${checkpoint.FwdICloud.done}`);
  
  // Get access token
  console.log("\n🔐 Authenticating with Microsoft Graph...");
  const accessToken = await getAccessToken();
  console.log("✅ Authenticated");
  
  // Discover folders
  console.log("\n📁 Discovering mail folders...");
  const folders = await discoverFolders(accessToken);
  
  if (folders.length === 0) {
    console.error("\n❌ No target folders found. Exiting.");
    process.exit(1);
  }
  
  folders.forEach(f => {
    console.log(`   ✅ Found: ${f.displayName} (${f.totalItemCount} items)`);
  });
  
  // Get existing entries for deduplication
  console.log("\n📋 Loading existing entries from database...");
  const existingEntries = await getAllExistingEntries();
  console.log(`   Found ${existingEntries.size} existing entries`);
  
  // Scan each folder
  const results = [];
  
  for (const folder of folders) {
    const result = await scanFolder(accessToken, folder, checkpoint, existingEntries);
    results.push({
      folder: folder.displayName,
      source: folder.source,
      ...result
    });
  }
  
  // Final summary
  console.log(`\n\n✅ SCAN COMPLETE\n`);
  console.log(`═══════════════════════════════════════════════════\n`);
  
  const totalScanned = results.reduce((sum, r) => sum + r.scanned, 0);
  const totalCreated = results.reduce((sum, r) => sum + r.created, 0);
  
  console.log(`📊 Final Summary:`);
  results.forEach(r => {
    console.log(`   ${r.folder} (${r.source}): Scanned ${r.scanned}, Created ${r.created}`);
  });
  
  console.log(`\n📈 Totals:`);
  console.log(`   Total emails scanned: ${totalScanned}`);
  console.log(`   Total rows created: ${totalCreated}`);
  console.log(`   Existing entries in database: ${existingEntries.size}`);
  
  console.log(`\n📎 Database: https://www.notion.so/${DATABASE_ID.replace(/-/g, '')}`);
}

main().catch(error => {
  console.error("❌ Fatal error:", error.message);
  console.error(error.stack);
  process.exit(1);
});
