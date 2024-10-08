const express =  require('express');   // express 모듈 가져오기
const app = express();                 // express 모듈 가져와서 app 인스턴스 생성
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const { Pool } = require('pg');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { log } = require('console');
const multer = require('multer');
const path = require('path');
const { v4 } = require('uuid');
const { send } = require('process');
const sharedSession = require('socket.io-express-session');
const twilio = require('twilio');
const twilioClient = twilio('tw', 'tw');
const verificationCodes = {};
const bcrypt = require('bcrypt');

//https://colab.research.google.com/drive/1IbRSNeSAZBm_6oszKSRzxABp-PbF9rTF?usp=sharing

// db 객체에 데이터베이스 username, host, database, password 지정 후 대입
const db = new Pool({
    user: 'user',
    host: 'host',
    database: 'db',
    password: 'pw',
    port: 0000,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});

//테스트 커밋용, 업로드 파일 디스크에 저장할 수 있도록 함. 
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'uploads/');           // 파일 'uploads/' 디렉토리 쪽에 저장
    },
    filename: function(req, file, cb) {
        cb(null, Date.now()+path.extname(file.originalname));
    }
});

// upload 객체 multer로 만들기 
const upload = multer({ storage: storage });
const _session = session({          // 세션 제작
    resave: true,
    saveUninitialized: false,
    secret: 'secret'
});

const cors = require('cors');
app.use(cors());
app.use(cookieParser());
app.use(_session);
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));  // 정적 파일 제공 설정
app.use(express.urlencoded({ extended: false }));
io.use(sharedSession(_session, {autoSave: true}));

app.set('view engine', 'ejs');

const port = 8000;
const host = 'localhost';

server.listen(port, host, function() {
    log(`Server host in http://${host}:${port}`);   // http://localhost + 위에 설정한 port(8000) 연결 후 메세지
});

// 정적 파일들 html, css 연결 도구
app.use('/js', express.static(__dirname + '/js'));
app.use('/css', express.static(__dirname + '/css'));
app.use('/uploads', express.static(__dirname + '/uploads'));
app.use('/processed', express.static(__dirname + '/processed'));
app.use("/main_css", express.static(__dirname + '/main_css'));
app.use("/image", express.static(__dirname + '/image'));
app.use("/build", express.static(__dirname + '/build'));

////////////////////////////////////////////////////////////////
// 정적 페이지 연결하기 문단

app.get('/find_password', function(req, res){
    res.render('find_password.ejs');  // 비밀번호 찾기 페이지 제공
})

app.get('/find_passwordauth', function(req, res) {
    res.render('find_passwordauth.ejs');  // 비밀번호 찾기 성공 페이지 제공
});

app.get('/find_password_success', function(req, res) {
    const { password } = req.session;
    if (password) {
        delete req.session.password;
        res.render('find_password_success.ejs', { password: password });
        return;
    }
    res.redirect('/');  // 비밀번호 찾기 성공 페이지 제공
});

app.get('/register', function(req, res){
    res.render('register.ejs');  // 회원가입 페이지 제공
})

// 정적 페이지 연결하기 문단
//////////////////////////////////////////////////////////////////////



///////////////////////////////////////////////////////////////////////
// 라우팅 설정 부분(ejs 확장자 파일 라우팅 추가할 경우 여기 문단쪽에 넣으시면 됩니다.)

app.get('/login', function(req, res) {
    const { user } = req.session;

    // 사용자가 로그인했는지 확인
    if (user) {
        // 사용자가 관리자가 아닌 경우, 홈 페이지로 리다이렉트
        res.redirect('/');
        return;
    }
    res.render('login.ejs'); // Serve login.html
});

// app.get('/logout', (req, res) => {
//     delete req.session.user;
//     res.redirect('/');
// })

app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('로그아웃 오류:', err);
            res.status(500).send('로그아웃 실패');
        } else {
            res.redirect('/login'); // 로그인 페이지로 리다이렉트
        }
    });
});

app.get('/calendar', function(req, res) {
    res.render('calendar.ejs');
});

app.get('/documentsummary', function(req, res) {
    res.render('document-summary.ejs');
});

app.get('/createreport', function(req, res) {
    res.render('createreport.ejs');
});

app.get('/register_confirm', function(req, res){
    const { name } = req.session;
    if (name) {
        delete req.session.name;
        res.render('register_confirm.ejs', name );  // register ejs
    } else {
        res.send('error');
    }
});

app.get('/uploads/:file', (req, res) => {
    const {file} = req.params;
    res.sendFile(__dirname+`/uploads/${file}`);
});

app.get('/filefolder', (req, res) => {
    res.render('filefolder');
})

app.get('/kanban', (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.redirect('/');
        return;
    }
    res.render('kanban');
});


// 라우팅 설정 부분(ejs 확장자 라우팅 추가할 경우 여기 문단쪽에 넣으시면 됩니다.)
/////////////////////////////////////////////////////////////////////////////////



/////////////////////////////////////////////////////////////////////////////////
// 로그인, 회원가입, 비밀번호 찾기 페이지의 엔드포인트 설정 부분

//로그인시 아이디랑 비밀번호 확인 후 로그인 동작
app.post('/login', async (req, res) => {
    const { id, password } = req.body;
    const data = await db.query(
        "select * from users where user_id=$1 and user_pw=$2",
        [id, password]
    );
    if (data.rows.length === 1) {
        const user_id = data.rows[0].user_id;
        const user_name = data.rows[0].user_name;
        const dep_id =  data.rows[0].dep_id;
        const user_type = data.rows[0].user_type;
        req.session.user = { user_id, user_name, user_type, dep_id };
        res.json({ success: true }); // AJAX 요청일 경우 성공 응답
    } else {
        res.json({ success: false, message: '아이디 또는 비밀번호가 잘못되었습니다.' });
    }
});


//아이디 중복 확인
app.post('/check-duplicate-id', async (req, res) => {
    const { userId } = req.body;

    try {
        const result = await db.query('SELECT COUNT(*) FROM users WHERE user_id = $1', [userId]);

        if (result.rows[0].count > 0) {
            res.json({ isDuplicate: true });
        } else {
            res.json({ isDuplicate: false });
        }
    } catch (error) {
    }
});


//회원 가입시 정보 db에 저장
app.post('/register', function(req, res) {
    const { id, name, phone, password } = req.body;
    req.session.name = { name };
    db.query(
        "insert into users (user_id, user_pw, user_name, user_phone) values ($1, $2, $3, $4)",
        [id, password, name, phone]
    )
    res.redirect('/register_confirm');
});


// 비밀번호 찾기 엔드포인트
app.post('/find_password', async (req, res) => {
    const { user_id } = req.body;

    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        // user_id에 해당하는 사용자를 찾는 쿼리
        const result = await db.query('SELECT user_name FROM users WHERE user_id = $1', [user_id]);

        if (result.rows.length > 0) {
            // 성공적인 응답과 리디렉션 URL 반환
            req.session.user_id = user_id;
            res.json({ 
                message: 'Password reset link has been sent.',
                redirectTo: 'find_passwordauth' 
            });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});


//핸드폰 인증코드 호출
app.post('/send-verification-code', (req, res) => {
    const { phone } = req.body;
    const verificationCode = Math.floor(100000 + Math.random() * 900000); // 6자리 코드 생성

    twilioClient.messages
        .create({
            body: `Your verification code is ${verificationCode}`,
            from: '+16194323674',
            to: phone
        })
        .then((message) => {
            verificationCodes[phone] = verificationCode;
            res.send({ success: true });
        })
        .catch((error) => {
            res.send({ success: false, error: 'Failed to send verification code' });
        });
});

//인증코드 인증
app.post('/verify-code', (req, res) => {
    const { phone, code } = req.body;
    if (verificationCodes[phone] && verificationCodes[phone] === parseInt(code)) {     // 여기서부터 인증 있게 하려면 주석해제할것
        req.session.isVerified = true; // 세션에 인증 정보 저장
        delete verificationCodes[phone]; // 인증 코드 삭제
        res.send({success: true});
    } else {
        res.send({ success: false, error: 'Invalid verification code' });
    }
    // req.session.isVerified = true;    // 인증 없이 하려면 이거 주석해제
    // res.send({success: true});        // 인증 없이 하려면 이거 주석해제
});

// 인증이 완료된 후 클라이언트에 리디렉션 URL을 제공하는 엔드포인트
app.post('/find_passwordauth', async (req, res) => {
    if (req.session.isVerified) {
        const { user_id } = req.session;

        if (!user_id) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        try {
            const result = await db.query('SELECT user_pw FROM users WHERE user_id = $1', [user_id]);
            
            if (result.rows.length > 0) {
                const password = result.rows[0].user_pw;
                
                // res.render('find_password_success', { password: password });
                
                req.session.password = password;
                
                // res.redirect('/find_password_success');
                res.json({ redirectTo: '/find_password_success' });
            } else {
                console.error('User not found for ID:', user_id);
                res.status(404).json({ error: 'User not found' });
            }
        } catch (error) {
            console.error('Error occurred during DB query or rendering:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    } else {
        res.status(400).json({ error: 'Authentication not completed' });
    }
});

// 위에서 패스워드 확인 성공시 엔드포인트(비밀번호 db 검색 후)
app.post('/find_password_success', async (req, res) => {
    const { user_id } = req.body;

    if (!user_id) {
        console.error('User ID is missing');
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        console.log('Querying database for user ID:', user_id);
        const result = await db.query('SELECT user_pw FROM users WHERE user_id = $1', [user_id]);

        if (result.rows.length > 0) {
            const password = result.rows[0].user_pw;

            res.render('find_password_success', { password: password });
        } else {
            console.error('User not found for ID:', user_id);
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        console.error('Error occurred during DB query or rendering:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


//////////////////////////////////////////////////////////////////////////////
// 메인 영역 페이지 엔드포인트 부분. 해당하는 건 여기에 넣어주시면 됩니다.

app.get('/', async (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.redirect('/login');
        return;
    }
    const profileImage = await db.query(
        "select user_image from users where user_id = $1",
        [ user.user_id]
    )

    res.render('main_iframe', {
        user: user, 
        profileImage: profileImage.rows[0].user_image
    });
});


// 캘린더 부분
app.post('/calendar/share', async (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.status(404).json({ message: 'need to login' });
    }
    const { calendarId, roomId } = req.body;
    const users = await db.query(
        'select user_id from room_users where room_id=$1',
        [roomId]
    );
    try {
        users.rows.forEach((u) => {
            if (u.user_id != user.user_id) {
                console.log(u.user_id);
                db.query(
                    'insert into calendar_shared (cal_id, user_id) values ($1, $2)',
                    [calendarId, u.user_id]
                );
            }
        });
        db.query(
            "update calendars set cal_sub_id = 'cal2' where cal_id = $1",
            [calendarId]
        );
        res.status(200).json({ message: 'success' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to save event to the database' });
    }
});

async function autoname(row, user) {
    const users = await db.query(
        `select user_name 
        from room_users ru join users u on ru.user_id = u.user_id 
        where room_id = $1 and u.user_id != $2`,
        [ row.room_id, user.user_id ]
    )
    let room_name = '';
    users.rows.forEach((user, i) => {
        room_name += user.user_name;
        if (i != users.rows.length-1) {
            room_name += ', ';
        }
    })
    row.room_name = room_name;
}

// 채팅방 부분
app.get('/chatroomframe', async (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.redirect('/login');
        return;
    }
    res.render('chatroom');
});

app.post('/chatroomframe', async (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.redirect('/login');
        return;
    }
    let chatroomList = await db.query(
        `select r.*, c.cl_chat, c.cl_type
        from rooms r left join 
        (select * 
         from chat_logs 
         where chat_at in 
         (select max(chat_at) 
          from chat_logs 
          group by room_id)) c 
        on r.room_id = c.room_id 
        where r.room_id in 
        (select room_id
         from room_users
         where user_id = $1)
        order by c.chat_at is null asc, c.chat_at desc`,
        [ user.user_id ]
    )
    for (let row of chatroomList.rows) {
        if (row.room_name == '\tauto name') {
            await autoname(row, user);
        }
    }
    // console.log(chatroomList.rows);
    res.send(chatroomList.rows);
});

app.get('/newchatroom', async (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.redirect('/login');
        return;
    }
    const userList = await db.query(
        "select user_id, user_name from users where user_id != $1",
        [ user.user_id ]
    );
    res.render('newchatroom', {
        user: user, 
        userList: userList.rows
    });
});

app.get('/aichat', async (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.redirect('/');
        return;
    }

    const chat_log = await db.query(
        'select ac_question, ac_answer from ai_chat_logs where user_id = $1 order by chat_at',
        [ user.user_id ]
    );

    res.render('ai_chat', {user: user, chat_log: chat_log.rows});
});

app.get('/aichat/reset', async (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.redirect('/');
        return;
    }

     await db.query(
         'delete from ai_chat_logs where user_id=$1',
         [ user.user_id ]
     );

    res.send({
        response: 'ok'
    });
})

//채팅페이지
app.get('/chat/:id', async function(req, res) {
    const { user } = req.session;
    const room_id = req.params.id;
    if (!user) {
        res.redirect('/');
        return;
    }
    const user_check = await db.query(
        "select ru_id from room_users where room_id=$1 and user_id=$2",
        [ room_id, user.user_id ]
    )
    if (!user_check) {
        res.redirect('/');
    }
    const room = await db.query(
        "select * from rooms where room_id=$1",
        [ room_id ]
    )
    console.log(!room.rows[0]);
    if (!room.rows[0]) {
        res.redirect('/');
        return;
    }

    if (room.rows[0].room_name == '\tauto name') {
        await autoname(room.rows[0], user);
    }
    const chat_log = await db.query(
        "select cl.user_id, user_name, cl_chat, cl_type from chat_logs cl join users us on cl.user_id = us.user_id where room_id=$1 order by cl.chat_at",
        [ room_id ]
    );
    const member = await db.query(
        "select u.user_name from room_users ru join users u on ru.user_id = u.user_id where ru.room_id=$1",
        [ room_id ]
    )
    res.render('chat.ejs', {room: room.rows[0], chat_log: chat_log.rows, member: member.rows, user: user});
});

app.get('/chatwith/:id', async (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.redirect('/');
        return;
    }
    const opp_id = req.params.id;
    const isUser = await db.query('select user_id from users where user_id=$1', [ opp_id ]);
    if (!isUser) {
        res.redirect('/');
    }
    console.log(opp_id);

    const room_id = await db.query(
        `select *
        from 
        (select r1.room_id id from 
        (select room_id from room_users where user_id=$1) r1
        join 
        (select room_id from room_users where user_id=$2) r2
        on r1.room_id = r2.room_id) i
        join rooms r
        on i.id = r.room_id
        where is_group = false`,
        [ user.user_id, opp_id ]
    );

    if (!room_id.rows[0]) {
        const roomId = v4();
        await db.query(
            'insert into rooms (room_id, room_name, is_group) values ($1, $2, $3)',
            [ roomId, '\tauto name', false ]
        );
        await db.query(
            'insert into room_users (room_id, user_id) values ($1, $2)',
            [roomId, user.user_id]
        );
        await db.query(
            'insert into room_users (room_id, user_id) values ($1, $2)',
            [roomId, opp_id]
        );
        res.redirect(`/chat/${roomId}`);
    } else {
        const roomId = room_id.rows[0].id;
        res.redirect(`/chat/${roomId}`);
    }
})

//소켓 통신 (채팅 부분)
io.on('connection', (socket) => {
    socket.on('join', (roomId) => {
        socket.join(roomId);
    })

    socket.on('msg', async (msg) => {
        const { user } = socket.handshake.session;
        db.query(
            "insert into chat_logs (user_id, room_id, cl_chat, cl_type) values ($1, $2, $3, $4)",
            [user.user_id, msg.room, msg.message, msg.type]
        );

        io.to(msg.room).emit('msg', {...msg, user_id: user.user_id, user_name: user.user_name});
        const users = await db.query(
            "select user_id from room_users where room_id=$1",
            [msg.room]
        );
        users.rows.forEach((user) => {
            io.to(user.user_id).emit('roomListUpdate', '');
        });
    });

    socket.on('roomListJoin', (msg) => {
        const { user } = socket.handshake.session;
        if (!user) {
            return;
        }
        socket.join(user.user_id);
    });
});

app.post('/newroom', async (req, res) => {
    const { user } = req.session;
    if ( !user ) {
        res.send({
            result: false,
        });
        return;
    }
    const { inviteList, roomName } = req.body;
    inviteList.push(user.user_id);
    const room_id = v4();
    const is_group = (inviteList.length != 2);
    const roomNameDb = (roomName=='') ? '\tauto name' : roomName;

    await db.query(
        'insert into rooms (room_id, room_name, is_group) values ($1, $2, $3)',
        [room_id, roomNameDb, is_group]
    );
    
    for (let id of inviteList) {
        await db.query(
            'insert into room_users (room_id, user_id) values ($1, $2)',
            [room_id, id]
        );
    }
    res.send({result: true, uuid: room_id});
});

// 메모 페이지 라우팅
app.get('/memo', (req, res) => {
    res.render('memo'); // 'memo.ejs'를 'views' 폴더에 위치시켜야 합니다.
});

app.get('/documentsummary', (req, res) => {
    res.render('document-summary');
})

app.post('/upload', upload.single('file'), function(req, res) {
    const file = req.file;
    res.send({
        result: 'ok',
        path: file.path
    });
});

// 업로드 경로 설정
app.post('/upload-profile-image', upload.single('profileImage'), (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.status(500).json({error: 'need to login'});
        return;
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    // 여기에 DB 업데이트 로직 추가
    db.query(
        'update users set user_image=$1 where user_id=$2',
        [ imageUrl, user.user_id ]
    );
    res.json({ imageUrl });
});

// 플라스크에 합쳐져서 이거 이제 없어도 됨.
    // 파일 다운로드 관련 엔드포인트
    // const { exec } = require('child_process');
    // const fs = require('fs');

    // 업로드된 파일 처리

    // app.post('/upload_summary', upload.single('file'), (req, res) => {
    //     const file = req.file;
    //     if (!file) {
    //         return res.status(400).send({ error: '파일 업로드 실패' });
    //     }

    //     console.log('Uploaded file path:', file.path);

    //     // 처리된 파일을 저장할 디렉토리 확인 및 생성
    //     if (!fs.existsSync('processed')) {
    //         fs.mkdirSync('processed');
    //     }

    //     // Python 스크립트 실행
    //     exec(`python ollama.py ${file.path}`, (error, stdout, stderr) => {
    //         if (error) {
    //             console.error(`exec error: ${error}`);
    //             return res.status(500).send({ error: '파일 처리 실패' });
    //         }

    //         // 처리된 파일 저장
    //         const processedFilePath = `processed/test_processed.docx`; // 처리된 파일 경로
    //         // const processedFilePath = `processed/.docx`; // 처리된 파일 경로
    //         // fs.writeFileSync(processedFilePath, stdout);

    //         // 클라이언트에게 처리 결과와 다운로드 링크 제공
    //         res.send({
    //             result: 'ok',
    //             originalFilePath: file.path,
    //             processedFilePath: `${path.basename(processedFilePath)}`,    // 다운로드 링크 제공
    //             output: stdout,
    //             error: stderr
    //         });
    //     });
    // });

    // // 처리된 파일 다운로드
    // app.get('/download/:filename', (req, res) => {
    //     const filename = req.params.filename;
    //     const filePath = path.join(__dirname, 'processed', filename);

    //     // 파일이 존재하는지 확인
    //     if (!fs.existsSync(filePath)) {
    //         return res.status(404).send('파일을 찾을 수 없습니다.');
    //     }

    //     res.download(filePath, filename, (err) => {
    //         if (err) {
    //             console.error(`Error downloading file: ${err}`);
    //             res.status(500).send('파일 다운로드 실패');
    //         }
    //     });
    // });

// Route to handle file upload and request to Flask server
app.post('/upload-summary', upload.array('files'), async (req, res) => {
    try {
        const files = req.files;

        // Send files to Flask server
        const formData = new FormData();
        files.forEach(file => {
            formData.append('files', fs.createReadStream(file.path), {
                filename: file.originalname,
                contentType: file.mimetype
            });
        });

        const response = await axios.post('http://localhost:5100/summary', formData, {
            headers: {
                ...formData.getHeaders(),
            },
        });

        // Clean up uploaded files
        files.forEach(file => fs.unlinkSync(file.path));

        // Return response from Flask server
        res.json(response.data);

    } catch (error) {
        console.error('Error during file upload:', error);
        res.status(500).json({ result: 'error', error: '파일 업로드 처리 중 오류가 발생했습니다.' });
    }
});


//결재 요청 보내기

app.post('/payment_req', async (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.send('invalid reqeust');
        return;
    }
    const { path, app, title } = req.body;
    const id = v4();
    await db.query(
        "insert into payment (p_id, p_uploader, p_path, p_app, p_title) values ($1, $2, $3, $4, $5)",
        [ id, user.user_id, path, app, title ]
    );
    
    const room_id = await db.query(
        `select *
        from 
        (select r1.room_id id from 
        (select room_id from room_users where user_id=$1) r1
        join 
        (select room_id from room_users where user_id=$2) r2
        on r1.room_id = r2.room_id) i
        join rooms r
        on i.id = r.room_id
        where is_group = false`,
        [ user.user_id, app ]
    );
    if (!room_id.rows[0]) {
        const roomId = v4();
        await db.query(
            'insert into rooms (room_id, room_name, is_group) values ($1, $2, $3)',
            [ roomId, '\tauto name', false ]
        );
        await db.query(
            'insert into room_users (room_id, user_id) values ($1, $2)',
            [roomId, user.user_id]
        );
        await db.query(
            'insert into room_users (room_id, user_id) values ($1, $2)',
            [roomId, app]
        );
        
        await db.query(
            "insert into chat_logs (user_id, room_id, cl_chat, cl_type) values ($1, $2, $3, $4)",
            [user.user_id, roomId, id, 'payment']
        );
        io.to(roomId).emit('msg', {message: id, type: 'payment', room: roomId, user_id: user.user_id, user_name: user.user_name});
    } else {
        const roomId = room_id.rows[0].id;
        await db.query(
            "insert into chat_logs (user_id, room_id, cl_chat, cl_type) values ($1, $2, $3, $4)",
            [user.user_id, roomId, id, 'payment']
        );
        io.to(roomId).emit('msg', {message: id, type: 'payment', room: roomId, user_id: user.user_id, user_name: user.user_name});
    }
    res.send( {uuid: id} );
});

//결재 요청 응답
app.post('/payment_res', upload.single('file'), async (req, res) => {
    const { user } = req.session;

    if (!user) {
        res.send('invalid request');
        return;
    }
    const file = req.file;
    const {uuid} = req.body;
    console.log('uuid: ', uuid);
    const data = await db.query(
        "select p_app from payment where p_id=$1",
        [ uuid ]
    );
    if (data.rows[0].p_app != user.user_id) {
        res.send(
            {result: false}
        );
    }

    await db.query(
        "update payment set app_at=now(), p_app_path=$1 where p_id=$2",
        [ file.path, uuid ]
    );

    res.send(
        { result: 'ok' }
    );
});

//결재 요청 페이지
app.get('/payment', async (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.send('invalid request');
        return;
    }
    const member = await db.query(
        "select user_id, user_name from users where user_id != $1",
        [ user.user_id ]
    )
    res.render('payment_request.ejs', { member: member.rows });
});

app.get('/payment/request', async (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.send('invalid request');
        return;
    }
    const user_id = user.user_id;
    const data = await db.query(
        "select * from payment where p_uploader=$1",
        [ user_id ]
    );
    res.send(data.rows);
});
app.get('/payment/response', async (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.send('invalid request');
        return;
    }
    const user_id = user.user_id;
    const data = await db.query(
        "select * from payment where p_app=$1",
        [ user_id ]
    );
    res.send(data.rows);
});

//결재 요청 url
app.get('/payment/:uuid', async (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.send('invalid request');
        return;
    }
    const id = req.params.uuid;
    const data = await db.query(
        "select * from payment where p_id=$1",
        [ id ]
    );
    if (!data.rows[0]) {
        res.send('invalid request');
        return;
    }
    const applied = (data.rows[0].app_at) ? true : false;
    const isApplier = (data.rows[0].p_app == user.user_id) ? true : false;
    res.render('payment.ejs', { uuid: id, applied: applied, isApplier: isApplier })
});

//결재 요청 url의 파일 다운로드 링크
app.get('/payment_file/:uuid', async (req, res) => {
    const id = req.params.uuid;
    const data = await db.query(
        "select * from payment where p_id=$1",
        [ id ]
    );
    if (data.rows[0].app_path) {
        res.download(data.rows[0].p_app_path);
    } else {
        res.download(data.rows[0].p_path);
    }
});

function dateParser(str) {
    function leftpad (str, len, ch) {
        str = String(str);
        var i = -1;
        if (!ch && ch !== 0) ch = '';
        len = len - str.length;
        while (++i < len) {
            str = ch + str;
        }
        return str;
    }

    let date = new Date(str.toString());
    let res_ = '';

    res_ += leftpad(date.getFullYear(), 4, 0) +'-';
    res_ += leftpad(date.getMonth()+1, 2, 0) +'-';
    res_ += leftpad(date.getDate(), 2, 0) +'T';
    res_ += leftpad(date.getHours(), 2, 0) +':';
    res_ += leftpad(date.getMinutes(), 2, 0) +":";
    res_ += leftpad(date.getSeconds(), 2, 0);

    return res_;
}

// 설정 부분 user db 속성 추출
app.get('/setting', async (req, res) => {
    const { user } = req.session; // 세션에서 user 속성을 추출

    if (!user) {
        res.redirect('/');
        return;
    }

    try {
        // 사용자 전화번호를 데이터베이스에서 조회
        const result = await db.query(
            'SELECT user_id, user_name, user_phone, user_image FROM users WHERE user_id = $1',
            [user.user_id]
        );

        if (result.rows.length === 0) {
            console.error("User not found in database");
            res.redirect('/');
            return;
        }

        // 조회된 사용자 정보
        const userData = result.rows[0];

        res.render('setting', {
            user: user,
            profileImage: userData.user_image,
            phone: userData.user_phone // 데이터베이스에서 가져온 전화번호
            
        });
    } catch (error) {
        console.error("Error querying database:", error);
        res.status(500).send("Internal Server Error");
    }
});

// 비밀번호 변경 요청 처리
app.post('/setting/change-password', async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const { user } = req.session;

    if (!user || !user.user_id) {
        return res.status(401).json({ message: '사용자가 로그인되어 있지 않거나 ID가 일치하지 않습니다.' });
    }

    const userId = user.user_id;

    try {
        const result = await db.query('SELECT user_pw FROM users WHERE user_id = $1', [userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
        }

        const storedPassword = result.rows[0].user_pw;

        if (currentPassword !== storedPassword) {
            return res.status(400).json({ message: '현재 비밀번호가 일치하지 않습니다.' });
        }

        await db.query('UPDATE users SET user_pw = $1 WHERE user_id = $2', [newPassword, userId]);
        console.log("비밀번호 업데이트 성공!")
        res.status(200).json({ message: '비밀번호가 성공적으로 변경되었습니다.' });
    } catch (error) {
        console.error('에러떴다 어떻게 하냐:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다. 다시 시도해 주세요.' });
    }
});

/////////////////////////////////////////////////////////////////////////////////////
// 캘린더 db 관련 데이터베이스 처리 부분 

// 이벤트 데이터를 처리하는 API 엔드포인트
app.post('/api/events', async (req, res) => {
    // console.log(req.body);
    // const { id, title, category, start, end, state, location, isReadOnly } = req.body;
    const { user } = req.session;
    
    if (!user) {
        res.redirect('/');
        return;
    }

    const { end, id, isAllday, isPrivate, location, start, state, title, calendarId } = req.body;
    

    try {
        // PostgreSQL에 이벤트 데이터를 저장
        await db.query(
            `INSERT INTO calendars(cal_id, user_id, cal_start_date, cal_end_date, cal_title, cal_location, is_allday, cal_state, cal_sub_id)
            VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [id, user.user_id, dateParser(start.d.d), dateParser(end.d.d), title, location, isAllday, state, calendarId ]
        );

        res.status(201).json({ message: 'Event successfully saved to the database' });
    } catch (error) {
        console.error('Error saving event to the database:', error);
        res.status(500).json({ message: 'Failed to save event to the database' });
    }
});

// 데이터 삭제 엔드포인트 추가
app.delete('/api/events/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await db.query('DELETE FROM calendars WHERE cal_id = $1 RETURNING *', [id]);

        if (result.rowCount > 0) {
            res.status(200).json({ message: 'Event deleted successfully', deletedEvent: result.rows[0] });
        } else {
            res.status(404).json({ message: 'Event not found' });
        }
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({ message: 'Failed to delete event from the database' });
    }
});

// 데이터 수정 엔드포인트 추가
app.put('/api/events/:id', async (req, res) => {
    const { id } = req.params;
    const { title, start, end, location, isAllday, state } = req.body;

    try {
        const result = await db.query(
            `UPDATE calendars
             SET cal_title = $1, cal_start_date = $2, cal_end_date = $3, cal_location = $4, is_allday = $5, cal_state = $6
             WHERE cal_id = $7
             RETURNING *`,
            [title, dateParser(start.d.d), dateParser(end.d.d), location, isAllday, state, id]
        );

        if (result.rowCount === 0) {
            res.status(404).json({ message: 'Event not found' });
        } else {
            res.status(200).json({ message: 'Event not found' });
        }
    } catch (error) {
        console.error('Error updating event in the database:', error);
        res.status(500).json({ message: 'Failed to update event in the database' });
    }
});


// 특정 사용자의 이벤트 가져오기 API
app.get('/api/events/:user_id', async (req, res) => {
    const { user_id } = req.params;

    try {
        const resultSelf = await db.query(
            'SELECT c.*, u.user_name FROM calendars c join users u on c.user_id=u.user_id WHERE c.user_id = $1',
            [user_id]
        );
        const resultShare = await db.query(
            'select c.*, u.user_name from calendars c join users u on c.user_id=u.user_id where c.cal_id in (select cal_id from calendar_shared where user_id=$1)',
            [user_id]
        )
        // console.log(result.rows);
        res.status(200).json({ 
            myCalendar: resultSelf.rows,
            shareCalendar: resultShare.rows
        });
    } catch (error) {
        console.error('Error fetching events from the database:', error);
        res.status(500).json({ message: 'Failed to fetch events from the database' });
    }
});

app.get('/session/user_id', (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.send('');
        return;
    }
    res.send(user.user_id);
});

app.get('/session/user_name', (req, res) => {
    const { user } = req.session;
    if (!user) {
        res.send('');
        return;
    }
    res.send(user.user_name);
});

app.get('/departments', async (req, res) => {
    try {
        // 부서 목록을 조회
        // const result = await db.query('SELECT dep_id, dep_name FROM departments');
        // let departments = result.rows;
        // console.log(departments);

        // 모든 직원 정보를 조회
        const usersResult = await db.query(
            'SELECT user_id, user_name, job_id, user_phone, user_type, user_image, d.dep_id, dep_name FROM users u JOIN departments d ON u.dep_id=d.dep_id'
        );
        const users = usersResult.rows;

        // 현재 사용자 정보
        const { user } = req.session;
        const isAdmin = user.user_type == 'admin';

        res.render('departments', { users, isAdmin });
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('서버 오류');
    }
});

// 부서 목록을 반환하는 엔드포인트
app.get('/departmentList', async (req, res) => {
    try {
        const result = await db.query('SELECT dep_id, dep_name FROM departments');
        const departments = result.rows;
        
        const { user } = req.session;
        const isAdmin = user.user_type === 'admin';

        res.json({ departments, isAdmin }); // 데이터와 관리자 여부를 JSON으로 반환
    } catch (error) {
        console.error('Error fetching departments:', error);
        res.status(500).json({ message: '서버 오류' });
    }
});


// app.get('/users/:id', async (req, res) => {
//     const userId = req.params.id;
//     try {
//         const result = await db.query(
//             'SELECT user_name, job_id, user_phone FROM users WHERE user_id = $1',
//             [userId]
//         );
//         if (result.rows.length === 0) {
//             res.status(404).json({ message: '사용자를 찾을 수 없습니다' });
//         } else {
//             res.json(result.rows[0]);
//         }
//     } catch (error) {
//         console.error('사용자 정보 조회 중 오류 발생:', error);
//         res.status(500).json({ message: '사용자 정보 조회 실패' });
//     }
// });


// 모든 사용자의 정보를 조회하는 엔드포인트
// app.get('/users', async (req, res) => {
//     try {
//         const result = await db.query(
//             'SELECT user_name, job_id, user_phone, user_type, u.dep_id, dep_name FROM users u join departments d on u.dep_id=d.dep_id'
//         );
//         res.json(result.rows);
//     } catch (error) {
//         console.error('Error fetching users:', error);
//         res.status(500).json({ message: 'Failed to fetch users' });
//     }
// });


///////////////////////////////////////////// kanban board api
app.get('/api/assignees', async (req, res) => {
    const dep_id =  req.session.user.dep_id
    try {
        const result = await db.query(
            'SELECT user_name FROM users where dep_id=$1', 
            [ dep_id ]
        );
        // console.log(result);        
        const assignees = result.rows.map(row => row.user_name);       
        res.json(assignees);
    } catch (error) {
        console.error('Error fetching assignees:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/api/cards', async (req, res) =>{
    
    try {
        const dep_id = req.session.user.dep_id; // 세션에서 사용자 정보 가져오기
        if (!req.session.user || (!dep_id && dep_id!=0)) {
            // 사용자 정보가 없거나 dep_id가 없는 경우
            return res.status(401).send('Unauthorized: No user or dep_id found');
        }

        // dep_id를 사용하여 쿼리 수행
        const result = await db.query('SELECT * FROM cards WHERE dep_id = $1', [dep_id]);
        
        // 필요한 형식으로 변환
        const cards = result.rows.map(row => ({
            id: row.c_id,
            title: row.c_title,
            content: row.c_content,
            category: row.c_category,
            dateRange: row.c_date_range,
            startDate: row.c_start_date,
            endDate: row.c_end_date,
            assignee: row.c_assignee,
            dep_id: row.dep_id
        }));

        res.json(cards);
    } catch (error) {
        console.error('Error fetching assignees:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/api/newcard/id', async (req, res) => {
    const last_id = await db.query(
        'select max(c_id)+1 as id from cards'
    );
    if (last_id.rows[0].id) {
        res.json(last_id.rows[0]);
    } else {
        res.json({id: 0});
    }
});

app.post('/api/newcard', async (req, res) => {
    const {id, title, content, category, data_range, start_date, end_date, assignee} = req.body;
    console.log('/api/newcard, req,body: ', req.body);
    const dep_id = req.session.user.dep_id
    try {
        await db.query(
            'insert into cards values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
            [ id, title, content, category, data_range, start_date, end_date, assignee, dep_id ]
        );
        res.status(200).send('success');
    } catch (error) {
        console.error('Error fetching assignees:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/api/editcard/title', async (req, res) => {
    const { id, title } = req.body;
    const dep_id = req.session.user.dep_id
    try {
        await db.query(
            'update cards set c_title=$2 where c_id=$1 and dep_id=$3',
            [ id, title, dep_id ]
        );
        res.status(200).send('success');
    } catch (error) {
        console.error('Error fetching assignees:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/api/editcard/text', async (req, res) => {
    const { id, content } = req.body;
    const dep_id = req.session.user.dep_id
    try {
        await db.query(
            'update cards set c_content=$2 where c_id=$1 and dep_id=$3',
            [ id, content, dep_id ]
        );
        res.status(200).send('success');
    } catch (error) {
        console.error('Error fetching assignees:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/api/editcard/category', async (req, res) => {
    const { id, category } = req.body;
    const dep_id = req.session.user.dep_id
    try {
        await db.query(
            'update cards set c_category=$2 where c_id=$1 and dep_id=$3',
            [ id, category, dep_id ]
        );
        res.status(200).send('success');
    } catch (error) {
        console.error('Error fetching assignees:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/api/editcard/date', async (req, res) => {
    const { id, dateRange, startDate, endDate } = req.body;
    const dep_id = req.session.user.dep_id
    try {
        await db.query(
            'update cards set c_date_range=$2, c_start_date=$3, c_end_date=$4 where c_id=$1 and dep_id=$5',
            [ id, dateRange, startDate, endDate, dep_id ]
        );
        res.status(200).send('success');
    } catch (error) {
        console.error('Error fetching assignees:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/api/editcard/assignee', async (req, res) => {
    const { id, assignee } = req.body;
    const dep_id = req.session.user.dep_id
    try {
        await db.query(
            'update cards set c_assignee=$2 where c_id=$1 and dep_id=$3',
            [ id, assignee, dep_id ]
        );
        res.status(200).send('success');
    } catch (error) {
        console.error('Error fetching assignees:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/api/deletecard', async (req, res) => {
    const { id } = req.body;
    const dep_id = req.session.user.dep_id
    try {
        await db.query(
            'delete from cards where c_id=$1 and dep_id=$2',
            [ id, dep_id ]
        );
        res.status(200).send('success');
    } catch (error) {
        console.error('Error fetching assignees:', error);
        res.status(500).send('Internal Server Error');
    }
});

// app.get('/users', function(req, res) {
//     const dep_name = req.query.dep_name;

//     // 해당 부서에 속하는 사원 목록을 데이터베이스에서 조회
//     db.query('SELECT * FROM users WHERE dep_name = ?', [dep_name], function(err, results) {
//         if (err) {
//             console.error(err);
//             return res.status(500).json({ error: '서버 오류' });
//         }
//         res.json({ users: results });
//     });
// });


app.post('/app-department', function(req, res) {
    const { dep_name } = req.body;

    // 데이터베이스에 새로운 부서 추가
    db.query(
        'INSERT INTO departments (dep_name) VALUES ($1)',
        [dep_name],
        function(err, result) {
        if (err) {
            console.error(err);
            return res.json({ success: false, message: '부서 추가에 실패했습니다.' });
        }
        res.json({ success: true });
    });
});

// 부서 삭제 엔드포인트
app.post('/delete-department', async (req, res) => {
    const { dep_id } = req.body; // 클라이언트로부터 dep_id 받기

    if (!dep_id) {
        console.error('No dep_id provided');
        return res.status(400).json({ success: false, message: '부서 ID가 제공되지 않았습니다.' });
    }

    try {
        // 데이터베이스에서 부서 삭제
        const result = await db.query(
            'DELETE FROM departments WHERE dep_id = $1',
            [dep_id]
        );

        if (result.rowCount === 0) {
            console.error('부서가 존재하지 않습니다.');
            return res.status(404).json({ success: false, message: '부서를 찾을 수 없습니다.' });
        }

        console.log('부서가 성공적으로 삭제되었습니다.'); // 성공 메시지 로그
        res.json({ success: true });
    } catch (error) {
        console.error('부서 삭제 실패:', error); // 에러 로그 추가
        res.status(500).json({ success: false, message: '부서 삭제에 실패했습니다.' });
    }
});

// 부서 추가 엔드포인트
app.post('/add-department', async (req, res) => {
    const { dep_name } = req.body; // 클라이언트로부터 dep_name 받기

    console.log('Received request to add department with name:', dep_name); // 요청 받은 부서 이름 로그

    // 부서 이름 유효성 검사 (예: 공백 및 길이 검사)
    if (!dep_name || dep_name.trim().length === 0) {
        console.error('No or invalid dep_name provided');
        return res.status(400).json({ success: false, message: '부서 이름이 제공되지 않았거나 유효하지 않습니다.' });
    }

    try {
        // 데이터베이스에 새로운 부서 추가
        const result = await db.query(
            'INSERT INTO departments (dep_name) VALUES ($1) RETURNING dep_id',
            [dep_name.trim()] // 입력값의 앞뒤 공백 제거
        );
        
        const dep_id = result.rows[0].dep_id;
        console.log('부서가 성공적으로 추가되었습니다.', dep_id); // 성공 메시지 로그

        res.json({ success: true, dep_id }); // 성공 응답
    } catch (error) {
        console.error('부서 추가 실패:', error); // 에러 로그 추가
        res.status(500).json({ success: false, message: '부서 추가에 실패했습니다.' });
    }
});

// 사용자 정보를 수정하는 엔드포인트
app.post('/updateUser/:id', async (req, res) => {
    const userId = req.params.id;
    const { job_id, dep_name } = req.body;

    try {
        // Get department ID based on department name
        const depResult = await db.query(
            'SELECT dep_id FROM departments WHERE dep_name = $1',
            [dep_name]
        );

        // Determine department ID, use null if not found
        const depId = depResult.rows.length > 0 ? depResult.rows[0].dep_id : null;

        // Update user information
        const result = await db.query(
            'UPDATE users SET job_id=$1, dep_id=$2 WHERE user_id=$3',
            [ job_id, depId, userId ]
        );

        if (result.rowCount > 0) {
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'Update failed' });
        }
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ message: 'Failed to update user' });
    }
});

app.get('/font/pretendard-regular', (req, res) => {
    res.download('./css/font/Pretendard-Regular.woff'); 
});