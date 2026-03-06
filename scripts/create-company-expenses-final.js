#!/usr/bin/env node

const { Client } = require("@notionhq/client");
const fs = require('fs');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function createCompanyExpensesDB() {
  try {
    const response = await notion.databases.create({
      parent: {
        type: "page_id",
        page_id: "2be0aea0-a9b6-8121-915d-e193105eed94" // NowOps HQ
      },
      title: [
        {
          type: "text",
          text: {
            content: "CompanyExpenses"
          }
        }
      ],
      properties: {
        "Description": { 
          title: {} 
        },
        "Amount": { 
          number: { 
            format: "dollar" 
          } 
        },
        "Currency": {
          select: {
            options: [
              { name: "CAD", color: "red" },
              { name: "USD", color: "blue" }
            ]
          }
        },
        "Date": { 
          date: {} 
        },
        "Vendor": { 
          rich_text: {} 
        },
        "Category": {
          select: {
            options: [
              { name: "Software", color: "blue" },
              { name: "Contractor", color: "purple" },
              { name: "Payroll", color: "green" },
              { name: "Office", color: "yellow" },
              { name: "Travel", color: "orange" },
              { name: "Marketing", color: "pink" },
              { name: "Legal", color: "red" },
              { name: "Tax", color: "brown" },
              { name: "Other", color: "gray" }
            ]
          }
        },
        "Status": {
          select: {
            options: [
              { name: "Pending", color: "yellow" },
              { name: "Approved", color: "green" },
              { name: "Reconciled", color: "blue" },
              { name: "Disputed", color: "red" }
            ]
          }
        },
        "PaymentMethod": {
          select: {
            options: [
              { name: "Credit Card", color: "blue" },
              { name: "Bank Transfer", color: "green" },
              { name: "Upwork", color: "green" },
              { name: "PayPal", color: "blue" },
              { name: "Cheque", color: "yellow" },
              { name: "Other", color: "gray" }
            ]
          }
        },
        "InvoiceNumber": { 
          rich_text: {} 
        },
        "ReceiptLink": { 
          url: {} 
        },
        "EvidenceLink": { 
          url: {} 
        },
        "CompletionAuthEvidenceLink": { 
          url: {} 
        },
        "VerificationStatus": {
          select: {
            options: [
              { name: "Unverified", color: "gray" },
              { name: "Verified", color: "green" },
              { name: "Flagged", color: "red" }
            ]
          }
        },
        "Source": {
          select: {
            options: [
              { name: "Outlook", color: "blue" },
              { name: "Gmail", color: "red" },
              { name: "iCloud", color: "gray" },
              { name: "Manual", color: "yellow" },
              { name: "Darby", color: "purple" }
            ]
          }
        },
        "MessageID": { 
          rich_text: {} 
        },
        "Notes": { 
          rich_text: {} 
        }
      }
    });

    console.log("✅ CompanyExpenses database created!");
    console.log("Database ID:", response.id);
    console.log("URL:", response.url);
    
    // Save to memory
    const memoryPath = '/Users/macmini2026/.openclaw/workspaces/darby/memory/2026-03-06.md';
    const entry = `\n## CompanyExpenses Database Created\n\n- **Database ID:** ${response.id}\n- **URL:** ${response.url}\n- **Parent:** NowOps HQ (2be0aea0-a9b6-8121-915d-e193105eed94)\n- **Created:** ${new Date().toISOString()}\n\n### Properties:\n- Description (title)\n- Amount (number, currency format)\n- Currency (select: CAD, USD)\n- Date (date)\n- Vendor (rich_text)\n- Category (select: 9 options)\n- Status (select: 4 options)\n- PaymentMethod (select: 6 options)\n- InvoiceNumber (rich_text)\n- ReceiptLink (url)\n- EvidenceLink (url)\n- CompletionAuthEvidenceLink (url)\n- VerificationStatus (select: 3 options)\n- Source (select: 5 options)\n- MessageID (rich_text)\n- Notes (rich_text)\n`;
    
    if (fs.existsSync(memoryPath)) {
      fs.appendFileSync(memoryPath, entry);
    } else {
      fs.writeFileSync(memoryPath, `# 2026-03-06 Memory\n${entry}`);
    }
    
    console.log("\n✅ Database ID saved to memory/2026-03-06.md");
    
    return response;
  } catch (error) {
    console.error("❌ Error creating database:", error.message);
    if (error.body) console.error(JSON.stringify(JSON.parse(error.body), null, 2));
    process.exit(1);
  }
}

createCompanyExpensesDB();
