// Import required modules
const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const path = require('path')

// Initialize Express app
const app = express()
app.use(express.json())

// Database initialization
const dbPath = path.join(__dirname, 'twitterClone.db')
let db = null

// Function to initialize database and server
const initializeDbAndServer = async () => {
  try {
    db = await open({filename: dbPath, driver: sqlite3.Database})
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (error) {
    console.error(`DB Error: ${error.message}`)
    process.exit(1)
  }
}

initializeDbAndServer()

// Middleware for authentication
const authentication = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader) {
    jwtToken = authHeader.split(' ')[1]
  }

  if (!jwtToken) {
    response.status(401).send('Invalid JWT Token')
    return
  }

  jwt.verify(jwtToken, 'SECRET_KEY', (error, payload) => {
    if (error) {
      response.status(401).send('Invalid JWT Token')
    } else {
      request.username = payload.username
      request.userId = payload.userId
      next()
    }
  })
}
// Function to get IDs of users followed by a given user
const getFollowingPeopleIdsOfUser = async username => {
  const getTheFollowingPeopleQuery = `
        SELECT following_user_id 
        FROM follower 
        INNER JOIN user ON user.user_id = follower.follower_user_id 
        WHERE user.username='${username}';
    `
  const followingPeople = await db.all(getTheFollowingPeopleQuery)
  return followingPeople.map(eachUser => eachUser.following_user_id)
}

// API - User Registration
app.post('/register/', async (request, response) => {
  try {
    const {username, password, name, gender} = request.body
    const getUserQuery = `SELECT * FROM user WHERE username = '${username}'`
    const userDBDetails = await db.get(getUserQuery)
    if (userDBDetails) {
      response.status(400).send('User already exists')
      return
    }
    if (password.length < 6) {
      response.status(400).send('Password is too short')
      return
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    const createUserQuery = `
            INSERT INTO user (username, password, name, gender)
            VALUES ('${username}', '${hashedPassword}', '${name}', '${gender}')
        `
    await db.run(createUserQuery)
    response.send('User created successfully')
  } catch (error) {
    console.error(error)
    response.status(500).send('Internal Server Error')
  }
})

// API - User Login
app.post('/login/', async (request, response) => {
  try {
    const {username, password} = request.body
    const getUserQuery = `SELECT * FROM user WHERE username='${username}'`
    const userDbDetails = await db.get(getUserQuery)
    if (!userDbDetails) {
      response.status(400).send('Invalid user')
      return
    }
    const isPasswordCorrect = await bcrypt.compare(
      password,
      userDbDetails.password,
    )
    if (!isPasswordCorrect) {
      response.status(400).send('Invalid password')
      return
    }
    const payload = {username, userId: userDbDetails.user_id}
    const jwtToken = jwt.sign(payload, 'SECRET_KEY')
    response.send({jwtToken})
  } catch (error) {
    console.error(error)
    response.status(500).send('Internal Server Error')
  }
})

// API - Fetch user's feed
app.get('/user/tweets/feed/', authentication, async (request, response) => {
  try {
    const {userId} = request

    // Fetch IDs of people whom the user follows
    const getFollowingPeopleIdsQuery = `
            SELECT following_user_id 
            FROM follower 
            WHERE follower_user_id = '${userId}';
        `
    const followingPeopleIds = await db.all(getFollowingPeopleIdsQuery)

    // If user doesn't follow anyone, return empty array
    if (followingPeopleIds.length === 0) {
      response.send([])
      return
    }

    // Fetch latest 4 tweets of people whom the user follows
    const followingIds = followingPeopleIds.map(
      entry => entry.following_user_id,
    )
    const getTweetsQuery = `
            SELECT u.username, t.tweet, t.datetime AS dateTime
            FROM tweet AS t
            INNER JOIN user AS u ON t.user_id = u.user_id
            WHERE t.user_id IN (${followingIds.join(',')})
            ORDER BY t.datetime DESC
            LIMIT 4;
        `
    const tweets = await db.all(getTweetsQuery)
    response.send(tweets)
  } catch (error) {
    console.error(error)
    response.status(500).send('Internal Server Error')
  }
})
// API - Fetch user's followers
app.get('/user/following/', authentication, async (request, response) => {
  try {
    const {userId} = request
    const getFollowingQuery = `
            SELECT name 
            FROM user 
            INNER JOIN follower ON user.user_id = follower.following_user_id
            WHERE follower.follower_user_id = '${userId}';
        `
    const followingList = await db.all(getFollowingQuery)
    response.send(followingList)
  } catch (error) {
    console.error(error)
    response.status(500).send('Internal Server Error')
  }
})
// API - Fetch tweet details by tweetId
app.get('/tweets/:tweetId/', authentication, async (request, response) => {
  try {
    const {tweetId} = request.params
    const {userId} = request

    // Check if the user follows the author of the tweet
    const checkFollowQuery = `
      SELECT user_id
      FROM follower
      WHERE following_user_id = (
        SELECT user_id
        FROM tweet
        WHERE tweet_id = '${tweetId}'
      ) AND follower_user_id = '${userId}';
    `
    const followResult = await db.get(checkFollowQuery)
    if (!followResult) {
      response.status(401).send('Invalid Request')
      return
    }

    const getTweetQuery = `
      SELECT tweet,
      (SELECT COUNT(*) FROM Like WHERE tweet_id = '${tweetId}') AS Likes,
      (SELECT COUNT(*) FROM reply WHERE tweet_id = '${tweetId}') AS replies,
      date_time AS dateTime
      FROM tweet
      WHERE tweet.tweet_id = '${tweetId}';
    `
    const tweet = await db.get(getTweetQuery)
    response.send(tweet)
  } catch (error) {
    console.error(error)
    response.status(500).send('Internal Server Error')
  }
})

// API - Fetch users who liked a tweet
app.get(
  '/tweets/:tweetId/likes/',
  authentication,
  async (request, response) => {
    try {
      const {tweetId} = request.params
      const {userId} = request

      // Check if the user follows the author of the tweet
      const checkFollowQuery = `
      SELECT user_id
      FROM follower
      WHERE following_user_id = (
        SELECT user_id
        FROM tweet
        WHERE tweet_id = '${tweetId}'
      ) AND follower_user_id = '${userId}';
    `
      const followResult = await db.get(checkFollowQuery)
      if (!followResult) {
        response.status(401).send('Invalid Request')
        return
      }

      const getLikesQuery = `
      SELECT username
      FROM user
      INNER JOIN Like ON user.user_id = Like.user_id
      WHERE tweet_id = '${tweetId}';
    `
      const likedUsers = await db.all(getLikesQuery)
      const usersArray = likedUsers.map(eachUser => eachUser.username)
      response.send({Likes: usersArray})
    } catch (error) {
      console.error(error)
      response.status(500).send('Internal Server Error')
    }
  },
)
// API - Fetch replies to a tweet
app.get(
  '/tweets/:tweetId/replies/',
  authentication,
  async (request, response) => {
    try {
      const {tweetId} = request.params
      const {userId} = request

      // Check if the user follows the author of the tweet
      const checkFollowQuery = `
      SELECT user_id
      FROM follower
      WHERE following_user_id = (
        SELECT user_id
        FROM tweet
        WHERE tweet_id = '${tweetId}'
      ) AND follower_user_id = '${userId}';
    `
      const followResult = await db.get(checkFollowQuery)
      if (!followResult) {
        response.status(401).send('Invalid Request')
        return
      }

      const getRepliesQuery = `
      SELECT name, reply
      FROM user
      INNER JOIN reply ON user.user_id = reply.user_id
      WHERE tweet_id = '${tweetId}';
    `
      const repliedUsers = await db.all(getRepliesQuery)
      response.send({replies: repliedUsers})
    } catch (error) {
      console.error(error)
      response.status(500).send('Internal Server Error')
    }
  },
)
// API - Fetch user's tweets
app.get('/user/tweets/', authentication, async (request, response) => {
  try {
    const {userId} = request
    const getTweetsQuery = `
            SELECT tweet,
            COUNT(DISTINCT Like_id) AS likes,
            COUNT(DISTINCT reply_id) AS replies,
            date_time AS dateTime
            FROM tweet 
            LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id 
            LEFT JOIN Like ON tweet.tweet_id = Like.tweet_id
            WHERE tweet.user_id = '${userId}'
            GROUP BY tweet.tweet_id;
        `
    const tweets = await db.all(getTweetsQuery)
    response.send(tweets)
  } catch (error) {
    console.error(error)
    response.status(500).send('Internal Server Error')
  }
})

// API - Delete a tweet
app.delete('/tweets/:tweetId/', authentication, async (request, response) => {
  try {
    const {tweetId} = request.params
    const {userId} = request

    // Check if the user is the author of the tweet
    const checkTweetQuery = `SELECT * FROM tweet WHERE user_id = '${userId}' AND tweet_id = '${tweetId}'`
    const tweet = await db.get(checkTweetQuery)
    if (!tweet) {
      response.status(401).send('Invalid Request')
      return
    }

    const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = '${tweetId}'`
    await db.run(deleteTweetQuery)
    response.send('Tweet Removed')
  } catch (error) {
    console.error(error)
    response.status(500).send('Internal Server Error')
  }
})
app.post('/user/tweets/', authentication, async (request, response) => {
  try {
    const {tweet} = request.body
    const {userId} = request
    const dateTime = new Date().toJSON().substring(0, 19).replace('T', '')
    const createTweetQuery = `
            INSERT INTO tweet(tweet, user_id, date_time) 
            VALUES('${tweet}', '${userId}', '${dateTime}')
        `
    await db.run(createTweetQuery)
    response.send('Created a Tweet')
  } catch (error) {
    console.error(error)
    response.status(500).send('Internal Server Error')
  }
})
app.get('/user/followers/', authentication, async (request, response) => {
  try {
    const {userId} = request
    const getFollowersQuery = `
      SELECT name
      FROM user
      INNER JOIN follower ON user.user_id = follower.follower_user_id
      WHERE following_user_id = '${userId}';
    `
    const followers = await db.all(getFollowersQuery)
    response.send(followers)
  } catch (error) {
    console.error(error)
    response.status(500).send('Internal Server Error')
  }
})
module.exports = app
