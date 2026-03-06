#!/usr/bin/env node

const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function updateDatabaseProperties() {
  try {
    const response = await notion.databases.update({
      database_id: "f20d4d1a59c34a54aa22b3adaf845764",
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

    console.log("✅ Database properties updated!");
    console.log("Database ID:", response.id);
    console.log("\nProperties configured:");
    Object.keys(response.properties).forEach(prop => {
      console.log(`- ${prop}: ${response.properties[prop].type}`);
    });
    
    return response;
  } catch (error) {
    console.error("❌ Error updating database:", error.message);
    if (error.body) console.error(JSON.stringify(JSON.parse(error.body), null, 2));
    process.exit(1);
  }
}

updateDatabaseProperties();
