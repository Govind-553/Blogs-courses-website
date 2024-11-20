const express = require('express');
const payment_route = express();
const bodyParser = require('body-parser');
payment_route.use(bodyParser.json());
payment_route.use(bodyParser.urlencoded({ extended: false }));

const path = require('path');
payment_route.set('view engine', 'ejs');
payment_route.set('views', path.join(__dirname, '../views'));

const paymentController = require('../controllers/paymentController');

payment_route.get('/index', (req, res) => {
    res.render('index');
});

payment_route.get('/', (req, res) => {
    res.render('index');
});

payment_route.get('/product', paymentController.renderProductPage);

// Route for creating order
payment_route.post('/createOrder', paymentController.createOrder);

module.exports = payment_route;
