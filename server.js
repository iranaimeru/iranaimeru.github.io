const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const tmi = require('tmi.js');
const { google } = require('googleapis');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// YouTube API設定
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});
let youtubeInterval = null;
let lastYoutubeId = null;

io.on('connection', (socket) => {
    let twitchClient = null;

    // 接続時にリクエストを受け取る
    socket.on('start-stream', async (data) => {
        const { twitchChannel, youtubeVideoId } = data;

        // 1. Twitch接続 (IRCベースのためリアルタイム)
        if (twitchChannel) {
            twitchClient = new tmi.Client({
                channels: [twitchChannel]
            });
            twitchClient.connect().catch(console.error);

            twitchClient.on('message', (channel, tags, message, self) => {
                io.emit('comment', {
                    platform: 'twitch',
                    badge: '🟣',
                    streamer: twitchChannel,
                    user: tags['display-name'] || tags.username,
                    text: message,
                    timestamp: Date.now()
                });
            });
        }

        // 2. YouTube接続 (APIポーリング: 4秒間隔)
        if (youtubeVideoId) {
            try {
                // 動画IDからライブチャットIDを取得
                const res = await youtube.videos.list({
                    part: 'liveStreamingDetails',
                    id: youtubeVideoId
                });
                const chatHtml = res.data.items[0]?.liveStreamingDetails?.activeLiveChatId;
                
                if (chatHtml) {
                    if (youtubeInterval) clearInterval(youtubeInterval);
                    
                    youtubeInterval = setInterval(async () => {
                        try {
                            const chatRes = await youtube.liveChatMessages.list({
                                liveChatId: chatHtml,
                                part: 'snippet,authorDetails',
                                maxResults: 20
                            });
                            
                            const messages = chatRes.data.items;
                            // 新着コメントのみを抽出して送信
                            let newMessages = [];
                            if (lastYoutubeId) {
                                const index = messages.findIndex(m => m.id === lastYoutubeId);
                                if (index !== -1) newMessages = messages.slice(index + 1);
                                else newMessages = messages;
                            } else {
                                newMessages = messages;
                            }

                            if (messages.length > 0) {
                                lastYoutubeId = messages[messages.length - 1].id;
                            }

                            newMessages.forEach(msg => {
                                io.emit('comment', {
                                    platform: 'youtube',
                                    badge: '🔴',
                                    streamer: 'YouTubeLive',
                                    user: msg.authorDetails.displayName,
                                    text: msg.snippet.displayMessage,
                                    timestamp: new Date(msg.snippet.publishedAt).getTime()
                                });
                            });
                        } catch (err) {
                            console.error("YouTube Chat Error:", err.message);
                        }
                    }, 4000); // 4秒制限
                }
            } catch (err) {
                console.error("YouTube Video Error:", err.message);
            }
        }
    });

    socket.on('disconnect', () => {
        if (twitchClient) twitchClient.disconnect();
        if (youtubeInterval) clearInterval(youtubeInterval);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
