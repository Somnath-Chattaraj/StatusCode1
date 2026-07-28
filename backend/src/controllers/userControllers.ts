import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import prisma from "../lib/prisma";
import { sign, verify } from "../lib/jwt";
import bcrypt from "bcrypt";
import sendMail from "../mail/sendMail";
import { Verifier } from "academic-email-verifier";
import checkCollegeEmail from "../mail/checkAcademic";
import { registerSchema } from "../validation/registerSchema";
import redis from "../lib/redis";
import { deleteCachedPosts } from "../lib/redis";
import axios from "axios";

const googleSignInOrSignUp = asyncHandler(
  //@ts-ignore
  async (req: Request, res: Response) => {
    const { email, displayName } = req.body;
    if (!process.env.SECRET) {
      throw new Error("Secret not found");
    }
    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });
    if (!user) {
      let isCollegeEmail;

      if (checkCollegeEmail(email)) {
        isCollegeEmail = true;
      } else {
        isCollegeEmail = await Verifier.isAcademic(email);
      }
      const user = await prisma.user.create({
        data: {
          email,
          collegeEmailVerified: isCollegeEmail,
          emailVerified: true,
        },
      });
      const exp = Date.now() + 1000 * 60 * 60 * 24 * 30;
      const token = await sign({ sub: user.user_id, exp }, process.env.SECRET);
      res.cookie("Authorization", token, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
      });
      const userId = user.user_id;
      const username = null;
      return res.status(201).json({ isCollegeEmail, userId, username });
    }
    const exp = Date.now() + 1000 * 60 * 60 * 24 * 30;
    const isCollegeEmail = false;
    const token = await sign({ sub: user.user_id, exp }, process.env.SECRET);
    res.cookie("Authorization", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
    });
    const username = user.username;
    const userId = user.user_id;
    res.status(200).json({ isCollegeEmail, username, userId });
  }
);

const githubSignInOrSignUp = asyncHandler(
  //@ts-ignore
  async (req: Request, res: Response) => {
    let { email } = req.body;
    if (!process.env.SECRET) {
      throw new Error("Secret not found");
    }
    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (!user) {
      let isCollegeEmail;

      if (checkCollegeEmail(email)) {
        isCollegeEmail = true;
      } else {
        isCollegeEmail = await Verifier.isAcademic(email);
      }
      const user = await prisma.user.create({
        data: {
          email,
          collegeEmailVerified: isCollegeEmail,
          emailVerified: true,
        },
      });
      const exp = Date.now() + 1000 * 60 * 60 * 24 * 30;
      const token = await sign({ sub: user.user_id, exp }, process.env.SECRET);
      res.cookie("Authorization", token, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
      });
      const userId = user.user_id;
      const username = null;
      return res.status(201).json({ isCollegeEmail, userId, username });
    }
    const exp = Date.now() + 1000 * 60 * 60 * 24 * 30;
    const isCollegeEmail = false;
    const token = await sign({ sub: user.user_id, exp }, process.env.SECRET);
    res.cookie("Authorization", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
    });
    const username = user.username;
    res.status(200).json({ isCollegeEmail, username });
  }
);

// @ts-ignore
const registerUser = asyncHandler(async (req: Request, res: Response) => {
  const {
    email,
    username,
    password,
    collegeName,
    courseName,
    isOnline,
    location,
    captchaToken,
  } = req.body;
  if (!process.env.SECRET) {
    throw new Error("Secret not found");
  }

  const response = await axios.post(
    `https://www.google.com/recaptcha/api/siteverify`,
    {},
    {
      params: {
        secret: process.env.RECAPTCHA_SECRET_KEY,
        response: captchaToken,
      },
    }
  );
  const { success } = response.data;
  if (!success) {
    return res.status(400).json({ error: "Invalid captcha" });
  }

  const hashedPassword = await bcrypt.hash(password, 8);
  if (!email || !username || !password || !captchaToken) {
    res.status(400).json({ message: "Please provide all fields" });
    return;
  }
  if (registerSchema.safeParse(req.body).success === false) {
    res.status(400).json({ message: registerSchema.safeParse(req.body).error });
    return;
  }
  const userExists = await prisma.user.findFirst({
    where: {
      OR: [{ email: email }, { username: username }],
    },
  });

  if (userExists) {
    res.status(409).json({ message: "User already exists" });
    return;
  }

  let isCollegeEmail;

  if (checkCollegeEmail(email)) {
    isCollegeEmail = true;
  } else {
    isCollegeEmail = await Verifier.isAcademic(email);
  }

  if (isCollegeEmail == true) {
    if (!courseName || !collegeName || !location || isOnline === undefined) {
      return res.status(400).json({ message: "Please provide all fields" });
    }
    let college = await prisma.college.findFirst({
      where: {
        name: collegeName,
      },
    });

    if (!college) {
      college = await prisma.college.create({
        data: {
          name: collegeName,
          location,
        },
      });
    }
    const college_id = college.college_id;
    let course = await prisma.course.findFirst({
      where: {
        name: courseName,
      },
    });
    let course_id;
    if (course) {
      course_id = course.course_id;
    } else {
      course = await prisma.course.create({
        data: {
          name: courseName,
          college_id,
          isOnline,
        },
      });
      course_id = course.course_id;
    }
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        username,
        collegeEmailVerified: true,
      },
    });
    const userCourse = await prisma.userCourse.create({
      data: {
        user_id: user.user_id,
        course_id,
        college_id,
      },
    });
    const exp = Date.now() + 1000 * 60 * 5;
    const token = await sign({ sub: user.user_id, exp }, process.env.SECRET);
    const url = `${process.env.BACKEND_URL}/api/user/verify/${token}`;
    const htmlContent = `<a href="${url}">Verify using this link</a>`;
    sendMail(htmlContent, email);
    res.status(201).json({ message: "User created" });
  } else {
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        username,
        collegeEmailVerified: false,
      },
    });
    const exp = Date.now() + 1000 * 60 * 5;
    const token = await sign({ sub: user.user_id, exp }, process.env.SECRET);
    const url = `${process.env.BACKEND_URL}/api/user/verify/${token}`;
    const htmlContent = `<a href="${url}">Verify using this link</a>`;
    sendMail(htmlContent, email);
    res.status(201).json({ message: "User created" });
  }
});
const resendURL = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ message: "Please provide all fields" });
    return;
  }
  const user = await prisma.user.findUnique({
    where: {
      email,
    },
  });
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  if (!user.password) {
    res.status(401).json({ message: "Logged in with Google Or Github" });
    return;
  }
});
const verifyUser = asyncHandler(async (req: Request, res: Response) => {
  const token = req.params.token;
  if (!token) {
    res.status(400).json({ message: "Invalid token" });
    return;
  }
  // @ts-ignore
  const { sub, exp } = await verify(token, process.env.SECRET);
  // @ts-ignore
  if (exp < Date.now()) {
    res
      .status(400)
      .json({ message: "Token expired. Login to verify your email" });
    return;
  }
  const user = await prisma.user.findUnique({
    where: {
      user_id: sub,
    },
  });
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  if (user.emailVerified) {
    res.status(400).json({ message: "User already verified" });
    return;
  }
  await prisma.user.update({
    where: {
      user_id: sub,
    },
    data: {
      emailVerified: true,
    },
  });
  res.status(200).json({ message: "User verified" });
});

const loginUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!process.env.SECRET) {
    throw new Error("Secret not found");
  }
  if (!email || !password) {
    res.status(400).json({ message: "Please provide all fields" });
    return;
  }
  const user = await prisma.user.findUnique({
    where: {
      email,
    },
  });
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  if (!user.password) {
    res.status(401).json({ message: "Logged in with Google Or Github" });
    return;
  }
  if (!user.emailVerified) {
    const exp = Date.now() + 1000 * 60 * 5;
    // @ts-ignore
    const token = await sign({ sub: user.user_id, exp }, process.env.SECRET);
    const url = `${process.env.BACKEND_URL}/api/user/verify/${token}`;
    const htmlContent = `<a href="${url}">Verify using this link</a>`;
    sendMail(htmlContent, email);
    res.status(201).json({ message: "Email Sent" });
    return;
  }
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30;
  const token = await sign({ sub: user.user_id, exp }, process.env.SECRET);
  res.cookie("Authorization", token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
  });
  res.status(200).json({ message: "User logged in" });
});

const getCurrentUserDetails = asyncHandler(
  async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({
      where: {
        // @ts-ignore
        user_id: req.user.user_id,
      },
      select: {
        user_id: true,
        email: true,
        username: true,
        pic: true,
        collegeEmailVerified: true,
        userCourses: {
          select: {
            Course: {
              select: {
                name: true,
                College: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
        reviews: true,
        chatRooms: true,
      },
    });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.status(200).json(user);
  }
);

const getUserDetailsById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.params.userId as string;
  const user = await prisma.user.findUnique({
    where: {
      user_id: userId,
    },
    select: {
      email: true,
      username: true,
      userCourses: {
        select: {
          Course: {
            select: {
              name: true,
              College: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
      reviews: true,
      chatRooms: true,
    },
  });
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  res.status(200).json(user);
});

// @ts-ignore
const addCourseToUser = asyncHandler(async (req: Request, res: Response) => {
  const { courseName, collegeName, isOnline, location } = req.body;
  if (!courseName || !collegeName || !location || isOnline === undefined) {
    return res.status(400).json({ message: "Please provide all fields" });
  }
  // @ts-ignore
  const userId = req.user.user_id;
  let college = await prisma.college.findFirst({
    where: {
      name: collegeName,
    },
  });
  if (!college) {
    college = await prisma.college.create({
      data: {
        name: collegeName,
        location,
      },
    });
  }
  const college_id = college.college_id;
  let course = await prisma.course.findFirst({
    where: {
      name: courseName,
    },
  });
  let course_id;
  if (course) {
    course_id = course.course_id;
  } else {
    course = await prisma.course.create({
      data: {
        name: courseName,
        college_id,
        isOnline,
      },
    });
    course_id = course.course_id;
  }
  await prisma.userCourse.create({
    data: {
      user_id: userId,
      course_id,
      college_id,
    },
  });
  res.status(201).json({ message: "Course added to user" });
});

// @ts-ignore
const addUsername = asyncHandler(async (req: Request, res: Response) => {
  const { username, id } = req.body;
  if (!username) {
    return res.status(400).json({ message: "Please provide all fields" });
  }
  const response = await prisma.user.findFirst({
    where: {
      OR: [{ username: username }],
    },
  });

  const user1 = await prisma.user.findUnique({
    where: {
      user_id: id,
    },
  });

  if (!user1) {
    return res.status(404).json({ message: "User not found" });
  }
  if (user1.username) {
    return res
      .status(409)
      .json({ message: "You are not authorized to change the username" });
  }

  if (response) {
    return res.status(409).json({ message: "Username already exists" });
  }
  await prisma.user.update({
    where: {
      user_id: id,
    },
    data: {
      username,
    },
  });
  res.status(201).json({ message: "Username updated" });
});

// @ts-ignore
const addDetailsToUser = asyncHandler(async (req: Request, res: Response) => {
  const { username, collegeName, courseName, isOnline, location, id } =
    req.body;
  if (
    !collegeName ||
    !courseName ||
    !location ||
    isOnline === undefined ||
    !username
  ) {
    return res.status(400).json({ message: "Please provide all fields" });
  }
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: username }],
    },
  });

  const user1 = await prisma.user.findUnique({
    where: {
      user_id: id,
    },
  });
  if (!user1) {
    return res.status(404).json({ message: "User not found" });
  }
  if (user1.username) {
    return res
      .status(409)
      .json({ message: "You are not authorized to change the username" });
  }

  if (user) {
    return res.status(409).json({ message: "Username already exists" });
  }
  await prisma.user.update({
    where: {
      user_id: id,
    },
    data: {
      username,
    },
  });
  let college = await prisma.college.findFirst({
    where: {
      name: collegeName,
    },
  });
  if (!college) {
    college = await prisma.college.create({
      data: {
        name: collegeName,
        location,
      },
    });
  }
  const college_id = college.college_id;
  let course = await prisma.course.findFirst({
    where: {
      name: courseName,
    },
  });
  let course_id;
  if (course) {
    course_id = course.course_id;
  } else {
    course = await prisma.course.create({
      data: {
        name: courseName,
        college_id,
        isOnline,
      },
    });
    course_id = course.course_id;
  }
  await prisma.userCourse.create({
    data: {
      user_id: id,
      course_id,
      college_id,
    },
  });
  res.status(201).json({ message: "Course added to user" });
});

const getAllUser = asyncHandler(async (req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    select: {
      user_id: true,
      username: true,
    },
  });
  res.status(200).json(users);
});

const logOut = asyncHandler(async (req: Request, res: Response) => {
  res.clearCookie("Authorization");
  res.status(200).json({ message: "Logged out" });
});

// @ts-ignore
const updateDetails = asyncHandler(async (req: Request, res: Response) => {
  // @ts-ignore
  const userId = req.user.user_id;
  let { username, pic } = req.body;
  if (!username) {
    // @ts-ignore
    username = req.user.username;
  }
  if (!pic) {
    // @ts-ignore
    pic = req.user.pic;
  }
  // @ts-ignore
  if (username !== req.user.username) {
    const response = await prisma.user.findFirst({
      where: {
        OR: [{ username: username }],
      },
    });
    if (response) {
      return res.status(409).json({ message: "Username already exists" });
    }
  }
  if (!pic) {
    // @ts-ignore
    pic = req.user.pic;
  }
  await prisma.user.update({
    where: {
      user_id: userId,
    },
    data: {
      username,
      // @ts-ignore
      pic,
    },
  });
  const college = await prisma.userCourse.findFirst({
    where: {
      user_id: userId,
    },
    select: {
      college_id: true,
    },
  });
  if (!college) {
    return res.status(404).json({ message: "User not found" });
  }
  await redis.del(`user:${userId}`);
  await deleteCachedPosts(college.college_id);
  return res.status(200).json({ message: "Details updated" });
});

export {
  registerUser,
  loginUser,
  verifyUser,
  getCurrentUserDetails,
  getUserDetailsById,
  addCourseToUser,
  googleSignInOrSignUp,
  githubSignInOrSignUp,
  addDetailsToUser,
  addUsername,
  getAllUser,
  logOut,
  updateDetails,
};
