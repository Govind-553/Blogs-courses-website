require('dotenv').config();
const express = require('express');
const formidable = require('formidable');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2');
const redis = require('redis');

const app = express();
const http = require('http').Server(app);

console.log('Views directory path:', path.join(__dirname, '../frontend/views'));

// Set the view engine and views directory
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../frontend/views'));

app.use(express.static(path.join(__dirname, '../frontend/public')));
app.use(express.urlencoded({ extended: true }));

// Local Database Configuration
const localDbConfig = {
    host: 'localhost',
    user: 'root',
    password: '123456',
    database: 'SciAstra',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(localDbConfig).promise();
// Redis Configuration
const redisClient = redis.createClient({
    url: process.env.REDIS_URL 
});
// Connect to Redis
(async () => {
    try {
        await redisClient.connect();
        console.log('Connected to Redis!');
    } catch (err) {
        console.error('Redis Connection Error:', err);
    }
})();

module.exports = { app, pool, redisClient };

// Route for rendering index.ejs
app.get('/', async (req, res) => {
    try {
        // Key for Redis caching
        const redisKey = 'home_data';

        // Check if data exists in Redis
        const cachedData = await redisClient.get(redisKey);

        if (cachedData) {
            console.log('Data fetched from Redis cache.');
            const { blogs, freeCourses, paidCourses } = JSON.parse(cachedData);
            return res.render('index', { blogs, freeCourses, paidCourses });
        }

        // Fetch Blogs from MySQL
        const blogsQuery = 'SELECT Blog_img, Blog_title, Blog_description, created_at, blog_link FROM blogs';
        const [blogResults] = await pool.query(blogsQuery);
        const blogs = blogResults.map(blog => ({
            ...blog,
            Blog_img: `data:image/jpeg;base64,${Buffer.from(blog.Blog_img).toString('base64')}`
        }));

        // Fetch Free Courses from MySQL
        const freeCoursesQuery = `
            SELECT course_img, coursename, price, link
            FROM courses 
            WHERE price = 0
        `;
        const [freeCourseResults] = await pool.query(freeCoursesQuery);
        const freeCourses = freeCourseResults.map(course => ({
            ...course,
            course_img: `data:image/jpeg;base64,${Buffer.from(course.course_img).toString('base64')}`
        }));

        // Fetch Paid Courses from MySQL
        const paidCoursesQuery = `
            SELECT course_img, coursename, price, link 
            FROM courses 
            WHERE price > 0
        `;
        const [paidCourseResults] = await pool.query(paidCoursesQuery);
        const paidCourses = paidCourseResults.map(course => ({
            ...course,
            course_img: `data:image/jpeg;base64,${Buffer.from(course.course_img).toString('base64')}`
        }));

        const dataToCache = { blogs, freeCourses, paidCourses };
        await redisClient.setEx(redisKey, 3600, JSON.stringify(dataToCache));

        // Render the data
        res.render('index', { blogs, freeCourses, paidCourses });
    } catch (err) {
        console.error('Error fetching data:', err);
        res.status(500).send('Internal Server Error');
    }
});

// Import and use payment routes
const paymentRoute = require('./routes/paymentRoute');
app.use('/', paymentRoute);

// Serve admin panel
app.get('/adminpanel', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/adminpanel', 'addnew.html'));
});
// Route for adding a new course
app.post('/add-course', (req, res) => {
    const form = new formidable.IncomingForm();
    form.uploadDir = path.join(__dirname, 'uploads');
    form.keepExtensions = true;

    if (!fs.existsSync(form.uploadDir)) {
        fs.mkdirSync(form.uploadDir);
    }

    form.parse(req, (err, fields, files) => {
        if (err) {
            console.error('Form parsing error:', err);
            return res.status(500).send('Error parsing form data');
        }

        if (files.courseImage && files.courseImage[0] && files.courseImage[0].size > 0) {
            if (files.courseImage[0].size > 5000000) { 
                console.error('Image size exceeds limit:', files.courseImage[0].size);
                return res.status(400).send('Image size exceeds 5MB limit');
            }
            const oldPath = files.courseImage[0].filepath;
            const newFileName = Date.now() + '_' + files.courseImage[0].originalFilename;
            const newPath = path.join(form.uploadDir, newFileName);

            // Move the file to the final location
            fs.rename(oldPath, newPath, (err) => {
                if (err) {
                    console.error('Error moving uploaded file:', err);
                    return res.status(500).send('Internal Server Error');
                }

                fs.readFile(newPath, (err, data) => {
                    if (err) {
                        console.error('Error reading image file:', err);
                        return res.status(500).send('Internal Server Error');
                    }

                    const query = `
                        INSERT INTO courses (course_img, coursename, price, course_type, link)
                        VALUES (?, ?, ?, ?, ?)
                    `;
                    pool.query(query, [
                        data,                          
                        fields.coursename,             
                        fields.price,
                        fields.coursetype,
                        fields.courselink
                    ], (err, result) => {
                        if (err) {
                            console.error('Database insertion error:', err);
                             return res.status(500).json({ success: false, message: 'Database error' });
                        }
                    });
                });
            });
        } else {
            console.error('No course image uploaded or file size is 0');
            return res.status(400).json('No image uploaded');
        }
    });
});

// Route for adding a new blog
app.post('/add-blog', (req, res) => {
    const form = new formidable.IncomingForm();
    form.uploadDir = path.join(__dirname, 'uploads');
    form.keepExtensions = true;

    if (!fs.existsSync(form.uploadDir)) {
        fs.mkdirSync(form.uploadDir);
    }

    form.parse(req, (err, fields, files) => {
        if (err) {
            console.error('Form parsing error:', err);
            return res.status(500).send('Error parsing form data');
        }

        if (files.BlogImage && files.BlogImage[0] && files.BlogImage[0].size > 0) {
            if (files.BlogImage[0].size > 5000000) { 
                console.error('Image size exceeds limit:', files.BlogImage[0].size);
                return res.status(400).send('Image size exceeds 5MB limit');
            }
            const oldPath = files.BlogImage[0].filepath;
            const newFileName = Date.now() + '_' + files.BlogImage[0].originalFilename;
            const newPath = path.join(form.uploadDir, newFileName);

            // Move the file to the final location
            fs.rename(oldPath, newPath, (err) => {
                if (err) {
                    console.error('Error moving uploaded file:', err);
                    return res.status(500).send('Internal Server Error');
                }

                fs.readFile(newPath, (err, data) => {
                    if (err) {
                        console.error('Error reading image file:', err);
                        return res.status(500).send('Internal Server Error');
                    }

                    // SQL query for inserting the blog into the database
                    const query = `
                        INSERT INTO BLOGS (Blog_title, Blog_description, Blog_img, category, blog_link)
                        VALUES (?, ?, ?, ?, ?)
                    `;
                    pool.query(query, [
                        fields.BlogTitle,           
                        fields.BlogDescription,      
                        data, 
                        fields.BlogCategory,
                        fields.bloglink
                    ], (err, result) => {
                        if (err) {
                            console.error('Database insertion error:', err);
                            return res.status(500).send('Error adding blog');
                        }
                    });
                });
            });
        } else {
            console.error('No blog image uploaded or file size is 0');
            return res.status(400).send('No image uploaded');
        }
    });
});
// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});


