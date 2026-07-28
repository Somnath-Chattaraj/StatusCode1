import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import prisma from "../lib/prisma";
import Fuse from "fuse.js";
import sendMail from "../mail/sendMail";
import { htmlToText } from "html-to-text";
import { setCachedData, getCachedData, deleteCachedPosts } from "../lib/redis";

// @ts-ignore
const searchPosts = asyncHandler(async (req: Request, res: Response) => {
  const { query } = req.body;

  if (!query) {
    return res.status(400).json({ message: "Search query is required" });
  }
  const cacheKey = `search:${query}`;
  const cachedResults = await getCachedData(cacheKey);
  if (cachedResults) {
    return res.status(200).json({ posts: JSON.parse(cachedResults) });
  }

  const posts = await prisma.post.findMany({
    select: {
      post_id: true,
      title: true,
      content: true,
      College: {
        select: {
          name: true,
        },
      },
      User: {
        select: {
          username: true,
          pic: true,
        },
      },
    },
  });

  const plainTextPosts = posts.map((post: any) => ({
    ...post,
    content: htmlToText(post.content, {
      wordwrap: false,
      preserveNewlines: true,
    }),
  }));

  const fuse = new Fuse(plainTextPosts, {
    keys: ["title", "content", "College.name"],
    threshold: 0.6,
  });

  const searchResults = fuse.search(query).map((result) => result.item);
  await setCachedData(cacheKey, JSON.stringify(searchResults), 300);

  return res.status(200).json({ posts: searchResults });
});

// @ts-ignore
const getCommunities = asyncHandler(async (req: Request, res: Response) => {
  // @ts-ignore
  const user_id = req.user.user_id;
  // const user_id = "clzfffeey0000e6hx5j16b96c";
  const communities = await prisma.userCourse.findMany({
    where: {
      user_id: user_id,
    },
    select: {
      college_id: true,
      College: {
        select: {
          name: true,
        },
      },
    },
    distinct: ["college_id"],
  });
  // @ts-ignore
  const communityIds = communities.map((community) => community.college_id);
  // @ts-ignore
  if (communityIds.length === 0) {
    return res.status(200).json({ communityIds: [] });
  }
  let college = [];
  for (let i = 0; i < communityIds.length; i++) {
    college[i] = await prisma.college.findUnique({
      where: {
        college_id: communityIds[i],
      },
      select: {
        college_id: true,
        name: true,
      },
    });
  }
  return res.status(200).json({ college });
});

// @ts-ignore
const createPost = asyncHandler(async (req: Request, res: Response, next) => {
  const { title, content, collegeId } = req.body;
  // @ts-ignore
  const user_id = req.user.user_id;

  if (!title || !content || !collegeId) {
    return res.status(400).json({ message: "Required fields are missing" });
  }

  const user = await prisma.user.findUnique({
    where: { user_id },
  });

  if (!user) {
    return res.status(404).json({ message: "User not recognized" });
  }

  const post = await prisma.post.create({
    // @ts-ignore
    data: {
      title,
      content,
      user_id,
      college_id: collegeId,
    },
  });
  await deleteCachedPosts(collegeId);
  return res.status(201).json({ post });
});

// @ts-ignore
const fetchPosts = asyncHandler(async (req: Request, res: Response) => {
  const { page, collegeId } = req.body;
  const pageNumber = page;

  const postsPerPage = 4;
  const offset = (pageNumber - 1) * postsPerPage;

  const cacheKey = `posts:${collegeId || "all"}:page:${pageNumber}`;

  const cachedResults = await getCachedData(cacheKey);
  if (cachedResults) {
    return res.status(200).json(JSON.parse(cachedResults));
  }

  const posts = await prisma.post.findMany({
    where: collegeId ? { college_id: collegeId } : {},
    orderBy: {
      createdAt: "desc",
    },
    select: {
      post_id: true,
      title: true,
      content: true,
      likes: true,
      College: {
        select: {
          name: true,
        },
      },
      User: {
        select: {
          username: true,
          pic: true,
        },
      },
      _count: {
        select: {
          Comments: true,
        },
      },
    },
    take: postsPerPage,
    skip: offset,
  });

  const totalPosts = await prisma.post.count();
  const isOver = offset + postsPerPage >= totalPosts;

  const result = { posts, isOver };
  await setCachedData(cacheKey, JSON.stringify(result), 600);

  return res.status(200).json({ posts, isOver });
});

// @ts-ignore
const likePost = asyncHandler(async (req: Request, res: Response) => {
  const { postId } = req.body;
  // @ts-ignore
  const post = await prisma.post.findUnique({
    where: { post_id: postId },
    select: {
      likes: true,
      College: {
        select: {
          college_id: true,
        },
      },
    },
  });
  // @ts-ignore
  const user_id = req.user.user_id;

  const like = await prisma.like.findFirst({
    where: {
      post_id: postId,
      user_id: user_id,
    },
  });

  if (like) {
    return res.status(400).json({ message: "Post already liked" });
  }

  if (!post) {
    return res.status(404).json({ message: "Post not found" });
  }

  const likes = post.likes + 1;

  const updatedPost = await prisma.post.update({
    where: { post_id: postId },
    data: {
      likes,
    },
  });

  await prisma.like.create({
    data: {
      post_id: postId,
      user_id,
    },
  });
  await deleteCachedPosts(post.College.college_id);

  return res.status(200).json({ updatedPost });
});

// @ts-ignore
const fetchSinglePost = asyncHandler(async (req: Request, res: Response) => {
  const postId = req.params.id as string;
  const post = await prisma.post.findUnique({
    where: { post_id: postId },
    select: {
      post_id: true,
      title: true,
      content: true,
      likes: true,
      College: {
        select: {
          name: true,
        },
      },
      User: {
        select: {
          user_id: true,
          username: true,
          pic: true,
        },
      },
      Comments: {
        select: {
          comment_id: true,
          content: true,
          user_id: true,
          User: {
            select: {
              user_id: true,
              username: true,
              pic: true,
            },
          },
        },
      },
    },
  });

  if (!post) {
    return res.status(404).json({ message: "Post not found" });
  }

  return res.status(200).json({ post });
});

// @ts-ignore
const deletePost = asyncHandler(async (req: Request, res: Response) => {
  const { postId } = req.body;
  const post = await prisma.post.findUnique({
    select: {
      User: {
        select: {
          user_id: true,
        },
      },
      College: {
        select: {
          college_id: true,
        },
      },
    },
    where: { post_id: postId },
  });

  // @ts-ignore
  const user_id = req.user.user_id;

  if (!post) {
    return res.status(404).json({ message: "Post not found" });
  }

  if (post.User.user_id !== user_id) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  // @ts-ignore
  await prisma.$transaction(async (prisma) => {
    await prisma.comment.deleteMany({
      where: { post_id: postId },
    });
    await prisma.like.deleteMany({
      where: { post_id: postId },
    });

    await prisma.post.delete({
      where: { post_id: postId },
    });
  });
  await deleteCachedPosts(post.College.college_id);

  return res.status(200).json({ message: "Post and comments deleted" });
});

// @ts-ignore
const createComment = asyncHandler(async (req: Request, res: Response) => {
  const { postId, content } = req.body;
  // @ts-ignore
  const user_id = req.user.user_id;

  if (!postId || !content) {
    return res.status(400).json({ message: "Required fields are missing" });
  }

  const user = await prisma.user.findUnique({
    where: { user_id },
  });

  if (!user) {
    return res.status(404).json({ message: "User not recognized" });
  }

  const comment = await prisma.comment.create({
    data: {
      content,
      user_id,
      post_id: postId,
    },
  });

  const post = await prisma.post.findUnique({
    where: { post_id: postId },
    select: {
      title: true,
      User: {
        select: {
          email: true,
          user_id: true,
        },
      },
      College: {
        select: {
          college_id: true,
        },
      },
    },
  });
  if (!post) {
    return res.status(404).json({ message: "Post not found" });
  }

  await deleteCachedPosts(post.College.college_id);

  if (post.User.user_id === user_id) {
    return res.status(201).json({ comment });
  }

  const email = post.User.email;
  const postTitle = post.title;
  const commentContent = comment.content;
  const commentAuthor = user.username;
  const htmlContent = `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f4; border-radius: 10px;">
    <h2 style="color: #4CAF50; text-align: center;">New Comment on Your Post</h2>
    
    <div style="background-color: white; padding: 20px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);">
      <h3 style="color: #333;">Post Title: ${postTitle}</h3>
      <p style="color: #666; font-size: 14px;">A new comment has been added to your post:</p>

      <blockquote style="background-color: #f9f9f9; border-left: 4px solid #4CAF50; padding: 10px 20px; margin: 10px 0; color: #555;">
        ${commentContent}
      </blockquote>

      <p style="color: #666; font-size: 14px;">Commented by: <strong>${commentAuthor}</strong></p>
      <a href="https://campusify.site/posts/${postId}" style="display: inline-block; margin-top: 20px; background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Post</a>
    </div>

    <footer style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
      <p>Campusify</p>
      <p><a href="https://campusify.site" style="color: #4CAF50;">Visit our website</a></p>
    </footer>
  </div>
`;

  sendMail(htmlContent, email, "New Comment on Your Post");
  // await deleteCachedPosts(post.College.college_id);

  return res.status(201).json({ comment });
});

// @ts-ignore
const deleteComment = asyncHandler(async (req: Request, res: Response) => {
  const { commentId } = req.body;
  const comment = await prisma.comment.findUnique({
    select: {
      User: {
        select: {
          user_id: true,
        },
      },
      post_id: true,
    },
    where: { comment_id: commentId },
  });
  // @ts-ignore
  const user_id = req.user.user_id;

  if (!comment) {
    return res.status(404).json({ message: "Comment not found" });
  }
  if (comment.User.user_id !== user_id) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await prisma.comment.delete({
    where: { comment_id: commentId },
  });
  const collegeId = await prisma.post.findUnique({
    select: {
      College: {
        select: {
          college_id: true,
        },
      },
    },
    where: { post_id: comment.post_id },
  });
  if (!collegeId) {
    return res.status(404).json({ message: "College not found" });
  }
  await deleteCachedPosts(collegeId.College.college_id);

  return res.status(200).json({ message: "Comment deleted" });
});

// @ts-ignore
const postLiked = asyncHandler(async (req: Request, res: Response) => {
  const { postId } = req.body;
  // @ts-ignore
  const user_id = req.user.user_id;
  const likes = await prisma.like.findFirst({
    where: {
      post_id: postId,
      user_id: user_id,
    },
  });
  if (likes) {
    return res.status(200).json({ postLiked: true });
  }
  return res.status(200).json({ postLiked: false });
});

// @ts-ignore
const unlikePost = asyncHandler(async (req: Request, res: Response) => {
  const { postId } = req.body;
  // @ts-ignore
  const user_id = req.user.user_id;

  const like = await prisma.like.findFirst({
    where: {
      post_id: postId,
      user_id: user_id,
    },
  });

  const post = await prisma.post.findUnique({
    where: { post_id: postId },
    select: {
      likes: true,
      College: {
        select: {
          college_id: true,
        },
      },
    },
  });

  if (!like) {
    return res.status(400).json({ message: "Post not liked" });
  }

  if (!post) {
    return res.status(404).json({ message: "Post not found" });
  }

  const likes = post.likes - 1;

  const updatedPost = await prisma.post.update({
    where: { post_id: postId },
    data: {
      likes,
    },
  });

  await prisma.like.delete({
    where: {
      like_id: like.like_id,
    },
  });
  await deleteCachedPosts(post.College.college_id);

  return res.status(200).json({ updatedPost });
});

// @ts-ignore
const getAllCommunities = asyncHandler(async (req: Request, res: Response) => {
  const college = await prisma.college.findMany({
    orderBy: {
      name: "asc",
    },
    select: {
      college_id: true,
      name: true,
    },
  });

  return res.status(200).json({ college });
});

export {
  getCommunities,
  createPost,
  fetchPosts,
  likePost,
  fetchSinglePost,
  createComment,
  postLiked,
  unlikePost,
  searchPosts,
  getAllCommunities,
  deletePost,
  deleteComment,
};
