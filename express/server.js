// ================= IMPORTACIONES =================
const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse');
const { Pool } = require('pg');
const fs = require('fs');

// =================== MONGODB ======================
const { MongoClient } = require('mongodb');
const uri = 'mongodb://localhost:27017';
const client = new MongoClient(uri);

// ================= CONFIG =========================
const app = express();
app.use(express.json());
const upload = multer({ dest: 'uploads/' });
require('dotenv').config()

// =================  CONEXION POOL ================= 
const pool = new Pool({
  user: process.env.USER_PSQL,
  host: process.env.HOST,
  database: process.env.DATABASE,
  password: process.env.PASSWORD,
  port: process.env.PORT,
});
// console.log(pool);

// ================  CONEXION MONGO ================ 
let logsCollection;
async function connectDB() {
    try {
        // CONECTION
        await client.connect();
        console.log('MONGO CONECTED');

        // CREATE DB
        const db = client.db('db_megastore_exam');
        console.log('DB CREATED');

        // CREATE COLLECTION
        logsCollection = db.collection('logs');
        console.log('COLLECTION CREATED');

    } catch (error) {
        console.log(error);
    }
};
connectDB();

// =============== LOGS FUNCTION ================
async function saveLog(action) {
    try {
        await logsCollection.insertOne({
            action,
            created_at: new Date()
        });
        console.log(`LOG ${action} ADDED`)
        
    } catch (error) {
        console.log('error en saveLog');
        
    }
}

// ================= CREAR TABLAS =================
async function createTables() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS city (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100)
    );
  `);
  saveLog('CREATE TABLE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS category (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100)
    );
  `);
  saveLog('CREATE TABLE');

    await pool.query(`
    CREATE TABLE IF NOT EXISTS sku (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100)
    );
  `);
  saveLog('CREATE TABLE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(55),
      email VARCHAR(55)
    );
  `);
  saveLog('CREATE TABLE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100),
      lastname VARCHAR(100),
      email VARCHAR(100),
      address VARCHAR(100),
      phone VARCHAR(100),
      city_id INT REFERENCES city(id)
    );
  `);
  saveLog('CREATE TABLE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product (
      id SERIAL PRIMARY KEY,
      category_id INT REFERENCES category(id),
      sku_id INT REFERENCES sku(id),
      name VARCHAR(100),
      unit_price DOUBLE PRECISION
    );
  `);
  saveLog('CREATE TABLE');


  await pool.query(`
    CREATE TABLE IF NOT EXISTS transaction (
      id SERIAL PRIMARY KEY,
      transaction_id VARCHAR(100),
      date DATE,
      customer_id INT REFERENCES customer(id), 
      product_id INT REFERENCES product(id), 
      quantity INTEGER, 
      total_line_value INTEGER, 
      supplier_id INT REFERENCES suppliers(id)
    );
  `);
  saveLog('CREATE TABLE');

}

createTables();


// ================= FUNCION GENERICA PARA UPLOAD =================
function uploadCSV(table, columns) {
  return async (req, res) => {
    const rows = [];

    fs.createReadStream(req.file.path)
      .pipe(parse({ columns: true, trim: true }))
      .on('data', row => rows.push(row))
      .on('end', async () => {
        try {
          if (rows.length) {
            const values = rows.map(r => {
              return `(${columns.map(col => `'${r[col]}'`).join(',')})`;
            }).join(',');

            await pool.query(
              `INSERT INTO ${table} (${columns.join(',')}) VALUES ${values}`
            );
             saveLog('INSERT');
          }

          res.json({ ok: true, total: rows.length });
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: 'Error inserting data' });
        }
      });
  };
}


// ================= ENDPOINTS =================
// CITIES
app.post('/api/upload/city',
  upload.single('archivo'),
  uploadCSV('city', ['name'])
);

// CATEGORIES
app.post('/api/upload/category',
  upload.single('archivo'),
  uploadCSV('category', ['name'])
);

// SKU PRODUCT ID
app.post('/api/upload/sku',
  upload.single('archivo'),
  uploadCSV('sku', ['name'])
);

// SUPPLIERS
app.post('/api/upload/suppliers',
  upload.single('archivo'),
  uploadCSV('suppliers', ['name','email'])
);

// CUSTOMER
app.post('/api/upload/customer',
  upload.single('archivo'),
  uploadCSV('customer', [
    'name',
    'lastname',
    'email',
    'address',
    'phone',
    'city_id'
  ])
);

// PRODUCT
app.post('/api/upload/product',
  upload.single('archivo'),
  uploadCSV('product', [
    'category_id',
    'sku_id',
    'name',
    'unit_price',
  ])
);

// TRANSACTIONS
app.post('/api/upload/transaction',
  upload.single('archivo'),
  uploadCSV('transaction', [
    'transaction_id',
    'date',
    'customer_id',
    'product_id',
    'quantity',
    'total_line_value',
    'supplier_id'
  ])
);

// ============= MONGO ENDPOINT ===========
app.get('/api/logs', async (req,res) =>{
    try {
        const logs = await logsCollection
            .find()
            .sort({ created_at : -1})
            .toArray();
        
        res.json(logs)
    } catch (error) {
        res.status(500).json({ error: 'Internal server error mongoDB' });
    }
});

// ==== SECONDARY FUNCTION TO FILTER =====
async function specific_data(product_id) {
  const response = await fetch(`http://localhost:3000/api/product/${product_id}`);

  if (!response.ok) {
    throw new Error("Error doing Query");
  }

  return await response.json();
}

// ============ FILTER ENDPOINT =============
// GET BY ID
app.get('/api/product/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM product p where p.id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    await saveLog('READ ONE');

    res.json(result.rows[0]);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error fetching transaction' });
  }
});


// ============= CRUD ENDPOINT ==============
// CREATE
app.post('/api/transaction', async (req, res) => {
  try {
    const {
      transaction_id,
      date,
      customer_id,
      product_id,
      quantity,
      supplier_id
    } = req.body;

    
    const response = await specific_data(product_id)
    // console.log(response.unit_price)

    const result = await pool.query(
      `INSERT INTO transaction 
      (transaction_id, date, customer_id, product_id, quantity, total_line_value, supplier_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
      [transaction_id, date, customer_id, product_id, quantity,response.unit_price * quantity, supplier_id]
    );

    await saveLog('CREATE RECORD');

    res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error creating transaction' });
  }
});

// GET ALL TRANSACTIONS
app.get('/api/transaction', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.id, t.transaction_id, t.date,
             c.name AS customer_name,
             p.name AS product_name,
             s.name AS ssuplier_name,
             t.quantity,
             t.total_line_value
      FROM transaction t
      LEFT JOIN customer c ON t.customer_id = c.id
      LEFT JOIN product p ON t.product_id = p.id
      LEFT JOIN suppliers s ON t.supplier_id = s.id
      ORDER BY t.id ASC
    `);

    await saveLog('READ ALL');

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error fetching transactions' });
  }
});

// GET TRANSACTION BY ID
app.get('/api/transaction/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT t.id, t.transaction_id, t.date,
             c.name AS customer_name,
             p.name AS product_name,
             s.name AS ssuplier_name,
             t.quantity,
             t.total_line_value
      FROM transaction t
      INNER join customer c ON t.customer_id = c.id
      INNER JOIN product p ON t.product_id = p.id
      INNER JOIN suppliers s ON t.supplier_id = s.id
      WHERE t.id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    await saveLog('READ ONE');

    res.json(result.rows[0]);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error fetching transaction' });
  }
});

// UPDATE TRANSACTION
app.put('/api/transaction/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      transaction_id,
      date,
      customer_id,
      product_id,
      quantity,
      supplier_id
    } = req.body;

    const response = await specific_data(product_id);

    const result = await pool.query(
      `UPDATE transaction SET
        transaction_id = $1,
        date = $2,
        customer_id = $3,
        product_id = $4,
        quantity = $5,
        total_line_value = $6,
        supplier_id = $7
      WHERE id = $8
      RETURNING *`,
      [transaction_id, date, customer_id, product_id, quantity,response.unit_price * quantity, supplier_id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    await saveLog('UPDATE');

    res.json(result.rows[0]);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error updating transaction' });
  }
});

// DELETE TRANSACTION
app.delete('/api/transaction/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM transaction WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    await saveLog('DELETE');

    res.json({ message: 'Transaction deleted successfully' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error deleting transaction' });
  }
});


//  ADVANCE QUERIES (BUSSINESS INTELLIGENCE)




// ================= SERVER =================
app.listen(3000, () => {
  console.log('SERVER http://localhost:3000');
});